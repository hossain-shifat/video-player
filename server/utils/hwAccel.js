"use strict";

/**
 * hwAccel.js — Hardware Acceleration & System Diagnostics Module
 * FLUX Media Server — Plex/Jellyfin-grade implementation
 *
 * Sections:
 *  1. Constants & Profiles
 *  2. Subprocess helpers
 *  3. Cache manager
 *  4. HW Accel detection (QSV → VAAPI → NVENC → CPU)
 *  5. OS probe
 *  6. CPU probe
 *  7. Memory probe
 *  8. GPU probe
 *  9. FFmpeg probe
 * 10. Storage probe
 * 11. Network / Runtime probes
 * 12. Transcoding analysis
 * 13. System health
 * 14. Main getSystemInfo()
 * 15. Public API helpers
 * 16. Express route handler
 * 17. Exports
 */

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 1: Constants & Profiles ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const DATA_DIR = path.join(__dirname, "../data");
const CACHE_FILE = path.join(DATA_DIR, "hwaccel_cache.json");
const SYSINFO_CACHE_FILE = path.join(DATA_DIR, "sysinfo_cache.json");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — hw accel (expensive)
const SYSINFO_CACHE_TTL = 5 * 60 * 1000; //  5m — sysinfo (health stales fast)

let _hwCached = null;
let _sysInfoCached = null;

/**
 * HW Accel profiles — priority: QSV > VAAPI > NVENC > CPU
 * @typedef {{ type: string, decodeFlag: string|null, encodeCodecH264: string,
 *             encodeCodecH265: string, hwDevice: string|null, supported: boolean }} HWProfile
 */
const PROFILES = {
    qsv: {
        type: "qsv",
        decodeFlag: "qsv",
        encodeCodecH264: "h264_qsv",
        encodeCodecH265: "hevc_qsv",
        hwDevice: null,
        supported: false,
    },
    vaapi: {
        type: "vaapi",
        decodeFlag: "vaapi",
        encodeCodecH264: "h264_vaapi",
        encodeCodecH265: "hevc_vaapi",
        hwDevice: "/dev/dri/renderD128",
        supported: false,
    },
    nvenc: {
        type: "nvenc",
        decodeFlag: "cuda",
        encodeCodecH264: "h264_nvenc",
        encodeCodecH265: "hevc_nvenc",
        hwDevice: null,
        supported: false,
    },
    // AMD AMF — Windows-only encoder API for AMD GPUs/APUs (e.g. the Vega
    // iGPU built into Ryzen "G"-series chips like the 5600G). Nothing in
    // the previous QSV/VAAPI/NVENC trio covers AMD hardware on Windows —
    // QSV is Intel-only, VAAPI is Linux-only, NVENC is Nvidia-only — so an
    // AMD APU on Windows always fell through to CPU with no HW option ever
    // attempted at all.
    amf: {
        type: "amf",
        decodeFlag: null,
        encodeCodecH264: "h264_amf",
        encodeCodecH265: "hevc_amf",
        hwDevice: null,
        supported: false,
    },
    // Apple VideoToolbox — macOS, works on BOTH Apple Silicon and Intel Macs
    // (the OS-level media framework, not tied to a specific chip vendor).
    videotoolbox: {
        type: "videotoolbox",
        decodeFlag: "videotoolbox",
        encodeCodecH264: "h264_videotoolbox",
        encodeCodecH265: "hevc_videotoolbox",
        hwDevice: null,
        supported: false,
    },
    // V4L2 M2M — Linux kernel media API used by ARM SoCs without a real GPU
    // driver stack (Raspberry Pi, most set-top-box-style ARM boards). No
    // HEVC encode support on most of these chips, so hevc falls back to
    // libx265 (software) rather than claiming a codec that doesn't exist.
    v4l2m2m: {
        type: "v4l2m2m",
        decodeFlag: null,
        encodeCodecH264: "h264_v4l2m2m",
        encodeCodecH265: "libx265",
        hwDevice: "/dev/video11",
        supported: false,
    },
    cpu: {
        type: "cpu",
        decodeFlag: null,
        encodeCodecH264: "libx264",
        encodeCodecH265: "libx265",
        hwDevice: null,
        supported: true,
    },
};

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 2: Subprocess helpers ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/** Run binary, resolve stdout+stderr, reject on error. */
function runBin(bin, args, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
        execFile(bin, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve(stdout + stderr);
        });
    });
}

/** runBin but never rejects — returns empty string on failure. */
async function runSafe(bin, args, timeoutMs = 8_000) {
    try {
        return await runBin(bin, args, timeoutMs);
    } catch {
        return "";
    }
}

/** Run shell command via sh/cmd. Never rejects. */
function runShell(cmd, timeoutMs = 8_000) {
    const isWin = process.platform === "win32";
    return new Promise((resolve) => {
        execFile(isWin ? "cmd" : "sh", isWin ? ["/c", cmd] : ["-c", cmd], { timeout: timeoutMs }, (_err, stdout) => resolve((stdout || "").trim()));
    });
}

/** FFmpeg shorthand — uses FFMPEG_PATH env if set (fixes Windows HW detection). */
function runFFmpeg(args) {
    let bin = process.env.FFMPEG_PATH || "ffmpeg";
    if (process.platform === "win32" && !bin.toLowerCase().endsWith(".exe")) {
        bin = bin + ".exe";
    }
    return runBin(bin, args, 12_000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 3: Cache manager ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function ensureDataDir() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch {}
}

function loadDiskCache(file, ttlMs) {
    try {
        const raw = fs.readFileSync(file, "utf-8");
        const obj = JSON.parse(raw);
        if (Date.now() - (obj._savedAt || 0) < ttlMs) return obj.data ?? obj;
    } catch {}
    return null;
}

function saveDiskCache(file, data) {
    try {
        ensureDataDir();
        const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
        fs.writeFileSync(tmp, JSON.stringify({ _savedAt: Date.now(), data }, null, 2));
        fs.renameSync(tmp, file);
    } catch (err) {
        console.warn("[Cache] Save failed:", err.message);
    }
}

function deleteDiskCache(file) {
    try {
        fs.unlinkSync(file);
    } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 4: HW Accel detection ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function checkQSV() {
    try {
        if (process.platform === "win32") {
            // Windows: just attempt encode test
            await runFFmpeg(["-hwaccel", "qsv", "-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-vframes", "1", "-f", "null", "-"]);
            return true;
        }
        if (!fs.existsSync("/dev/dri/renderD128")) return false;
        await runFFmpeg(["-hwaccel", "qsv", "-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-vframes", "1", "-f", "null", "-"]);
        return true;
    } catch {
        return false;
    }
}

async function checkVAAPI() {
    try {
        if (process.platform !== "linux") return false;
        if (!fs.existsSync("/dev/dri/renderD128")) return false;
        await runFFmpeg(["-hwaccel", "vaapi", "-hwaccel_device", "/dev/dri/renderD128", "-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-vframes", "1", "-f", "null", "-"]);
        return true;
    } catch {
        return false;
    }
}

async function checkNVENC() {
    try {
        await runFFmpeg(["-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-vframes", "1", "-c:v", "h264_nvenc", "-f", "null", "-"]);
        return true;
    } catch {
        return false;
    }
}

async function checkAMF() {
    try {
        // AMF is Windows-only (DirectX-based) — don't bother probing on
        // Linux/macOS where it can't exist.
        if (process.platform !== "win32") return false;
        await runFFmpeg(["-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-vframes", "1", "-c:v", "h264_amf", "-f", "null", "-"]);
        return true;
    } catch {
        return false;
    }
}

async function checkVideoToolbox() {
    try {
        if (process.platform !== "darwin") return false;
        await runFFmpeg(["-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-vframes", "1", "-c:v", "h264_videotoolbox", "-f", "null", "-"]);
        return true;
    } catch {
        return false;
    }
}

async function checkV4L2M2M() {
    try {
        if (process.platform !== "linux") return false;
        // Real ARM SBC hardware encoders enumerate under /dev/videoN — if
        // none exist there's no point spawning ffmpeg to find out further.
        const hasVideoDevice = await runShell("ls /dev/video* 2>/dev/null").then((out) => Boolean(out && out.trim()));
        if (!hasVideoDevice) return false;
        await runFFmpeg(["-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-vframes", "1", "-c:v", "h264_v4l2m2m", "-f", "null", "-"]);
        return true;
    } catch {
        return false;
    }
}

/**
 * getCompiledEncoders() — one cheap `ffmpeg -encoders` call, cached for the
 * lifetime of the process. Used as a pre-filter so detect() never spawns a
 * doomed test-encode for a codec that isn't even built into this ffmpeg
 * binary (some distro/Docker-image ffmpeg builds omit qsv/vaapi/amf/
 * videotoolbox entirely) — cuts several seconds off a cold detect() run.
 */
let _encoderListCache = null;
async function getCompiledEncoders() {
    if (_encoderListCache) return _encoderListCache;
    const out = await runSafe("ffmpeg", ["-encoders", "-hide_banner"]);
    const lines = out.split("\n").filter((l) => /^\s+[A-Z.]+\s+/.test(l));
    _encoderListCache = new Set(lines.map((l) => l.trim().split(/\s+/)[1]).filter(Boolean));
    return _encoderListCache;
}

/**
 * detect() — returns best available HWProfile. Memory + disk cached.
 *
 * Covers every mainstream GPU vendor across every OS ffmpeg runs on:
 *   Windows : QSV (Intel) → NVENC (Nvidia) → AMF (AMD)
 *   Linux   : QSV (Intel) → VAAPI (Intel/AMD unified) → NVENC (Nvidia) → V4L2M2M (ARM SBCs, e.g. Raspberry Pi)
 *   macOS   : VideoToolbox (Apple Silicon AND Intel Macs — one API for both)
 *   any OS  : CPU (libx264/libx265) — universal fallback, always works
 *
 * Each candidate is skipped immediately (no subprocess spawned) if either:
 *   (a) it's structurally impossible on this OS (checked inside each
 *       checkX() function already), or
 *   (b) this ffmpeg build doesn't have that encoder compiled in at all
 *       (getCompiledEncoders() pre-filter below).
 * Only encoders that pass both get a real functional test-encode.
 */
async function detect() {
    if (_hwCached) return _hwCached;

    const fromDisk = loadDiskCache(CACHE_FILE, CACHE_TTL_MS);
    if (fromDisk) {
        _hwCached = fromDisk;
        console.log(`[HWAccel] Disk cache hit: ${_hwCached.type}`);
        return _hwCached;
    }

    // Env override support
    const envOverride = process.env.HWACCEL;
    if (envOverride && PROFILES[envOverride]) {
        _hwCached = { ...PROFILES[envOverride], supported: true };
        console.log(`[HWAccel] Env override: ${envOverride}`);
        saveDiskCache(CACHE_FILE, _hwCached);
        return _hwCached;
    }

    const plat = process.platform;
    // Ordered per-OS — only candidates that are even theoretically possible
    // on this platform are listed, so nothing wastes time being tried on an
    // OS where it structurally cannot exist.
    const candidatesByPlatform = {
        win32: [
            { profile: "qsv", check: checkQSV, encoderName: "h264_qsv", label: "Intel QuickSync (QSV)" },
            { profile: "nvenc", check: checkNVENC, encoderName: "h264_nvenc", label: "NVIDIA NVENC" },
            { profile: "amf", check: checkAMF, encoderName: "h264_amf", label: "AMD AMF" },
        ],
        linux: [
            { profile: "qsv", check: checkQSV, encoderName: "h264_qsv", label: "Intel QuickSync (QSV)" },
            { profile: "vaapi", check: checkVAAPI, encoderName: "h264_vaapi", label: "VAAPI (Intel/AMD)" },
            { profile: "nvenc", check: checkNVENC, encoderName: "h264_nvenc", label: "NVIDIA NVENC" },
            { profile: "v4l2m2m", check: checkV4L2M2M, encoderName: "h264_v4l2m2m", label: "V4L2 M2M (ARM SBC, e.g. Raspberry Pi)" },
        ],
        darwin: [{ profile: "videotoolbox", check: checkVideoToolbox, encoderName: "h264_videotoolbox", label: "Apple VideoToolbox" }],
    };
    const candidates = candidatesByPlatform[plat] || [];

    console.log(`[HWAccel] Detecting hardware acceleration on ${plat} (${candidates.map((c) => c.label).join(" → ")}${candidates.length ? " → " : ""}CPU)...`);

    const compiledEncoders = await getCompiledEncoders();

    for (const candidate of candidates) {
        if (!compiledEncoders.has(candidate.encoderName)) {
            console.log(`[HWAccel] ✗ ${candidate.label} — not compiled into this ffmpeg build, skipping`);
            continue;
        }
        // eslint-disable-next-line no-await-in-loop
        if (await candidate.check()) {
            _hwCached = { ...PROFILES[candidate.profile], supported: true };
            console.log(`[HWAccel] ✓ ${candidate.label}`);
            saveDiskCache(CACHE_FILE, _hwCached);
            return _hwCached;
        }
        console.log(`[HWAccel] ✗ ${candidate.label} — compiled in but test encode failed (driver/permissions?)`);
    }

    _hwCached = { ...PROFILES.cpu, supported: true };
    console.log("[HWAccel] CPU fallback (no working hardware acceleration found)");
    saveDiskCache(CACHE_FILE, _hwCached);
    return _hwCached;
}

/** Force re-detection on next call. */
function invalidate() {
    _hwCached = null;
    deleteDiskCache(CACHE_FILE);
    console.log("[HWAccel] Cache invalidated");
}

/**
 * getFFmpegHWDecodeArgs(profile) — returns FFmpeg input-side hw decode flags.
 * @param {HWProfile} profile
 * @returns {string[]}
 */
function getFFmpegHWDecodeArgs(profile) {
    if (!profile || profile.type === "cpu") return [];
    if (profile.type === "vaapi") {
        return ["-hwaccel", "vaapi", "-hwaccel_device", profile.hwDevice, "-hwaccel_output_format", "vaapi"];
    }
    if (profile.type === "qsv") {
        return ["-hwaccel", "qsv", "-hwaccel_output_format", "qsv"];
    }
    if (profile.type === "nvenc") {
        return ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"];
    }
    return [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 5: Format helpers ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function fmtBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function fmtGb(bytes) {
    return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

function fmtUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 6: OS probe ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function probeOS() {
    console.log("[SysInfo] Probing OS...");
    const plat = process.platform;
    const info = {
        type: os.type(),
        platform: plat,
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: os.uptime(),
        uptimeFormatted: fmtUptime(os.uptime()),
        version: os.version ? os.version() : null,
        kernelVersion: null,
        distro: null,
        isDocker: false,
        isWSL: false,
        isCasaOS: false,
        isVirtual: false,
        virtType: null,
    };

    // Docker detection
    try {
        info.isDocker = fs.existsSync("/.dockerenv") || (fs.existsSync("/proc/1/cgroup") && fs.readFileSync("/proc/1/cgroup", "utf-8").includes("docker"));
    } catch {}

    if (plat === "linux") {
        // WSL
        try {
            const procVer = fs.readFileSync("/proc/version", "utf-8");
            info.isWSL = /microsoft|wsl/i.test(procVer);
        } catch {}

        // Kernel
        info.kernelVersion = await runShell("uname -r");

        // Distro
        try {
            const osRelease = fs.readFileSync("/etc/os-release", "utf-8");
            const m = osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
            if (m) info.distro = m[1].trim();
        } catch {
            info.distro = await runShell("lsb_release -ds 2>/dev/null | head -1");
        }

        // CasaOS detection
        info.isCasaOS = fs.existsSync("/etc/casaos") || fs.existsSync("/usr/share/casaos");

        // Virtualization
        const virt = await runShell("systemd-detect-virt 2>/dev/null || echo none");
        info.isVirtual = Boolean(virt && virt !== "none" && virt !== "");
        info.virtType = info.isVirtual ? virt : null;
    }

    if (plat === "win32") {
        info.kernelVersion = await runShell("ver");
    }

    return info;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 7: CPU probe ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function probeCPU() {
    console.log("[SysInfo] Probing CPU...");
    const cpus = os.cpus();
    const model = cpus[0]?.model || "Unknown";
    const logicalCores = cpus.length;
    const speedMHz = cpus[0]?.speed || 0;
    const loadAvg = os.loadavg();

    // Physical cores estimate
    let physicalCores = logicalCores;
    if (process.platform === "linux") {
        const raw = await runShell("nproc --all 2>/dev/null || echo 0");
        const p = parseInt(raw, 10);
        if (p > 0) physicalCores = p;
    }

    const isIntel = /intel/i.test(model);
    const isAMD = /amd/i.test(model);
    const hyperthreading = logicalCores > physicalCores;
    const cpuUsage = await getCpuUsagePercent();

    let avx = false,
        avx2 = false;
    if (process.platform === "linux") {
        try {
            const cpuinfo = fs.readFileSync("/proc/cpuinfo", "utf-8");
            avx = cpuinfo.includes(" avx ");
            avx2 = cpuinfo.includes(" avx2 ");
        } catch {}
    }

    return {
        model,
        physicalCores,
        logicalCores,
        speedMHz,
        speedGHz: (speedMHz / 1000).toFixed(2),
        loadAvg1m: loadAvg[0] ?? 0,
        loadAvg5m: loadAvg[1] ?? 0,
        loadAvg15m: loadAvg[2] ?? 0,
        usagePercent: cpuUsage,
        arch: os.arch(),
        isIntel,
        isAMD,
        hyperthreading,
        avx,
        avx2,
    };
}

/** Sample CPU usage over ~200ms window. */
function getCpuUsagePercent() {
    return new Promise((resolve) => {
        const start = os.cpus().map((c) => ({ ...c.times }));
        setTimeout(() => {
            const end = os.cpus();
            let idle = 0,
                total = 0;
            for (let i = 0; i < start.length; i++) {
                const s = start[i],
                    e = end[i].times;
                const t = Object.keys(e).reduce((a, k) => a + e[k] - (s[k] || 0), 0);
                idle += e.idle - s.idle;
                total += t;
            }
            resolve(total === 0 ? 0 : Math.round((1 - idle / total) * 1000) / 10);
        }, 200);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 8: Memory probe ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function probeMemory() {
    console.log("[SysInfo] Probing memory...");
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const info = {
        totalBytes: total,
        freeBytes: free,
        usedBytes: used,
        total: fmtGb(total),
        free: fmtGb(free),
        used: fmtGb(used),
        usagePercent: Math.round((used / total) * 1000) / 10,
        swap: null,
    };

    if (process.platform === "linux") {
        try {
            const meminfo = fs.readFileSync("/proc/meminfo", "utf-8");
            const stBytes = parseInt(meminfo.match(/SwapTotal:\s+(\d+)/)?.[1] || "0", 10) * 1024;
            const sfBytes = parseInt(meminfo.match(/SwapFree:\s+(\d+)/)?.[1] || "0", 10) * 1024;
            info.swap = {
                totalBytes: stBytes,
                freeBytes: sfBytes,
                usedBytes: stBytes - sfBytes,
                total: fmtGb(stBytes),
                used: fmtGb(stBytes - sfBytes),
            };
        } catch {}
    }

    return info;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 9: GPU probe ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function probeGPU() {
    console.log("[GPU] Probing GPU...");
    const plat = process.platform;
    const info = {
        vendor: "unknown",
        model: null,
        renderDevices: [],
        vaapi: false,
        qsv: false,
        nvenc: false,
        cuda: false,
        hasNvidiaDriver: false,
        driverVersion: null,
        vainfoOutput: null,
        cpuTempCelsius: null,
        gpuUtilization: null,
        gpuMemoryUsed: null,
    };

    if (plat === "linux") {
        // /dev/dri
        try {
            const dri = "/dev/dri";
            if (fs.existsSync(dri)) {
                info.renderDevices = fs.readdirSync(dri).map((f) => `${dri}/${f}`);
            }
        } catch {}

        // vainfo
        const vainfo = await runShell("vainfo 2>&1 | head -20");
        if (vainfo && !vainfo.includes("command not found")) {
            info.vaapi = vainfo.includes("VA-API version");
            info.vainfoOutput = vainfo.substring(0, 500);
        }

        // NVIDIA — query GPU model, driver, utilization, memory
        const nvSmi = await runShell("nvidia-smi --query-gpu=name,driver_version,utilization.gpu,memory.used --format=csv,noheader,nounits 2>/dev/null | head -1");
        if (nvSmi && nvSmi.trim()) {
            info.hasNvidiaDriver = true;
            info.nvenc = true;
            info.cuda = true;
            info.vendor = "NVIDIA";
            const p = nvSmi.split(",").map((s) => s.trim());
            info.model = p[0] || null;
            info.driverVersion = p[1] || null;
            info.gpuUtilization = p[2] ? `${p[2]}%` : null;
            info.gpuMemoryUsed = p[3] ? `${p[3]} MiB` : null;
        }

        // Intel via lspci
        const lspci = await runShell("lspci 2>/dev/null | grep -iE 'VGA|3D|Display'");
        if (lspci) {
            if (/intel/i.test(lspci) && info.vendor === "unknown") {
                info.vendor = "Intel";
                info.qsv = fs.existsSync("/dev/dri/renderD128");
                const m = lspci.match(/Intel[^[]+\[([^\]]+)\]/);
                if (m) info.model = m[1];
            }
            if (/amd|radeon/i.test(lspci) && info.vendor === "unknown") {
                info.vendor = "AMD";
            }
        }

        // CPU temperature
        const tempRaw = await runShell("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null");
        if (tempRaw && !isNaN(parseInt(tempRaw, 10))) {
            info.cpuTempCelsius = Math.round(parseInt(tempRaw, 10) / 1000);
        }
    }

    if (plat === "win32") {
        const wmicOut = await runShell("wmic path win32_VideoController get Name,DriverVersion /format:csv 2>nul");
        const lines = wmicOut.split("\n").filter((l) => l.includes(",") && !l.toLowerCase().includes("node,name"));
        if (lines.length > 0) {
            // CSV: Node, DriverVersion, Name
            const parts = lines[0].split(",").map((s) => s.trim());
            const name = parts[2] || parts[1] || "";
            info.model = name || null;
            info.driverVersion = parts[1] || null;
            if (/intel/i.test(name)) {
                info.vendor = "Intel";
                info.qsv = true;
            } else if (/nvidia/i.test(name)) {
                info.vendor = "NVIDIA";
                info.nvenc = true;
                info.cuda = true;
                info.hasNvidiaDriver = true;
            } else if (/amd|radeon/i.test(name)) {
                info.vendor = "AMD";
            }
        }
    }

    return info;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 10: FFmpeg probe ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function probeFFmpeg() {
    console.log("[FFmpeg] Probing capabilities...");

    const info = {
        available: false,
        version: null,
        buildDate: null,
        ffprobeAvailable: false,
        ffprobeVersion: null,
        hwaccels: [],
        encoders: [],
        decoders: [],
        protocols: [],
        hasNVENC: false,
        hasQSV: false,
        hasVAAPI: false,
        hasLibx264: false,
        hasLibx265: false,
        hasCudaDecoder: false,
        configuration: null,
    };

    const verOut = await runSafe("ffmpeg", ["-version"]);
    if (!verOut) {
        console.warn("[FFmpeg] ffmpeg binary not found");
        return info;
    }
    info.available = true;
    const verMatch = verOut.match(/ffmpeg version ([^\s]+)/);
    if (verMatch) info.version = verMatch[1];
    const buildMatch = verOut.match(/built on (.+?) with/);
    if (buildMatch) info.buildDate = buildMatch[1].trim();
    const confMatch = verOut.match(/configuration: (.+)/);
    if (confMatch) info.configuration = confMatch[1].trim().substring(0, 500);

    // ffprobe
    const fpOut = await runSafe("ffprobe", ["-version"]);
    if (fpOut) {
        info.ffprobeAvailable = true;
        const m = fpOut.match(/ffprobe version ([^\s]+)/);
        if (m) info.ffprobeVersion = m[1];
    }

    // hwaccels
    const hwOut = await runSafe("ffmpeg", ["-hwaccels", "-hide_banner"]);
    info.hwaccels = hwOut
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !/^(Hardware|ffmpeg)/i.test(l) && !/^\s*$/.test(l));

    // encoders
    const encOut = await runSafe("ffmpeg", ["-encoders", "-hide_banner"]);
    const encLines = encOut.split("\n").filter((l) => /^\s+[A-Z.]+\s+/.test(l));
    info.encoders = encLines
        .map((l) => l.trim().split(/\s+/)[1])
        .filter(Boolean)
        .slice(0, 300);
    info.hasNVENC = info.encoders.some((e) => e.includes("nvenc"));
    info.hasQSV = info.encoders.some((e) => e.includes("qsv"));
    info.hasVAAPI = info.encoders.some((e) => e.includes("vaapi"));
    info.hasLibx264 = info.encoders.includes("libx264");
    info.hasLibx265 = info.encoders.includes("libx265");

    // decoders
    const decOut = await runSafe("ffmpeg", ["-decoders", "-hide_banner"]);
    const decLines = decOut.split("\n").filter((l) => /^\s+[A-Z.]+\s+/.test(l));
    info.decoders = decLines
        .map((l) => l.trim().split(/\s+/)[1])
        .filter(Boolean)
        .slice(0, 200);
    info.hasCudaDecoder = info.decoders.some((d) => d.includes("cuvid") || d.includes("cuda"));

    // protocols
    const protoOut = await runSafe("ffmpeg", ["-protocols", "-hide_banner"]);
    info.protocols = protoOut
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !/^(Output|Input|ffmpeg)/i.test(l) && !/^\s*$/.test(l))
        .slice(0, 80);

    return info;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 11: Storage probe ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function probeStorage() {
    console.log("[SysInfo] Probing storage...");
    const drives = [];

    if (process.platform === "linux") {
        const dfOut = await runShell("df -BK --output=source,size,used,avail,pcent,target 2>/dev/null | tail -n +2");
        for (const line of dfOut.split("\n")) {
            const p = line.trim().split(/\s+/);
            if (p.length < 6) continue;
            if (/^(tmpfs|devtmpfs|udev|none|overlay)/.test(p[0])) continue;
            const toBytes = (s) => parseInt(s.replace(/K$/, ""), 10) * 1024;
            drives.push({
                device: p[0],
                total: fmtBytes(toBytes(p[1])),
                used: fmtBytes(toBytes(p[2])),
                available: fmtBytes(toBytes(p[3])),
                usagePercent: parseInt(p[4], 10),
                mountPoint: p[5],
            });
        }
    }

    if (process.platform === "win32") {
        const wmicOut = await runShell("wmic logicaldisk get DeviceID,Size,FreeSpace /format:csv 2>nul");
        for (const line of wmicOut.split("\n")) {
            const p = line.split(",").map((s) => s.trim());
            if (p.length < 4 || !p[1]) continue;
            const total = parseInt(p[3], 10);
            const free = parseInt(p[2], 10);
            if (!total || isNaN(total)) continue;
            drives.push({
                device: p[1],
                total: fmtBytes(total),
                used: fmtBytes(total - free),
                available: fmtBytes(free),
                usagePercent: Math.round(((total - free) / total) * 100),
                mountPoint: p[1],
            });
        }
    }

    return { drives };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 12: Network & Runtime probes ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function probeNetwork() {
    const ifaces = os.networkInterfaces();
    const result = [];
    for (const [name, addrs] of Object.entries(ifaces)) {
        for (const addr of addrs) {
            if (addr.internal) continue;
            result.push({
                interface: name,
                family: addr.family,
                address: addr.address,
                mac: addr.mac,
                type: /^(eth|en)/i.test(name) ? "ethernet" : /^(wlan|wl|wi)/i.test(name) ? "wifi" : "other",
            });
        }
    }
    return result;
}

function probeRuntime() {
    const mu = process.memoryUsage();
    return {
        nodeVersion: process.version,
        nodeArch: process.arch,
        pid: process.pid,
        processUptimeSec: Math.floor(process.uptime()),
        processUptimeFmt: fmtUptime(process.uptime()),
        memUsage: {
            rss: fmtBytes(mu.rss),
            heapTotal: fmtBytes(mu.heapTotal),
            heapUsed: fmtBytes(mu.heapUsed),
            external: fmtBytes(mu.external),
        },
        env: {
            HWACCEL: process.env.HWACCEL || null,
            NODE_ENV: process.env.NODE_ENV || null,
            PORT: process.env.PORT || null,
            TMDB_API_KEY: process.env.TMDB_API_KEY ? "[SET]" : null,
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 13: Transcoding analysis ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function analyzeTranscoding(hwProfile, ffmpegInfo, cpuInfo) {
    const hwType = hwProfile?.type || "cpu";
    const hasHW = hwType !== "cpu";
    const cores = cpuInfo.physicalCores || 2;

    // Session estimate: HW = 2× due to fixed pipeline; CPU = cores/4 min 1
    const maxSessions = hasHW ? Math.max(2, Math.floor(cores / 2) * 2) : Math.max(1, Math.floor(cores / 4));

    const preferredEncoder = hwType === "qsv" ? "h264_qsv" : hwType === "vaapi" ? "h264_vaapi" : hwType === "nvenc" ? "h264_nvenc" : ffmpegInfo.hasLibx264 ? "libx264" : "libx265";

    const preferredH265Encoder = hwType === "qsv" ? "hevc_qsv" : hwType === "vaapi" ? "hevc_vaapi" : hwType === "nvenc" ? "hevc_nvenc" : ffmpegInfo.hasLibx265 ? "libx265" : null;

    const preferredDecoder = hwType === "qsv" ? "h264_qsv" : hwType === "nvenc" ? "h264_cuvid" : "native";

    return {
        directPlay: true,
        directStream: true,
        hardwareAcceleration: hasHW,
        realtimeCapable: hasHW || cores >= 4,
        maxRecommendedSessions: maxSessions,
        preferredEncoder,
        preferredDecoder,
        recommendedH264Encoder: preferredEncoder,
        recommendedH265Encoder: preferredH265Encoder,
        hwAccelType: hwType,
        supportedProfiles: [hwType],
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 14: System health ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function buildHealth(cpuInfo, memInfo, ffmpegInfo, hwProfile) {
    const cpu = cpuInfo.usagePercent || 0;
    const mem = memInfo.usagePercent || 0;
    const hwHealthy = hwProfile?.supported && hwProfile.type !== "cpu";
    const overall = cpu < 85 && mem < 85 && ffmpegInfo.available ? "healthy" : cpu > 95 || mem > 95 ? "critical" : "degraded";

    return {
        cpuUsagePercent: cpu,
        memoryUsagePercent: mem,
        lowMemoryWarning: mem > 85,
        highCpuWarning: cpu > 85,
        hardwareAccelerationHealthy: hwHealthy,
        ffmpegHealthy: ffmpegInfo.available,
        ffprobeHealthy: ffmpegInfo.ffprobeAvailable,
        gpuHealthy: hwHealthy,
        overall,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 15: Main getSystemInfo() ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * getSystemInfo() — full system diagnostics.
 * Cached in memory for SYSINFO_CACHE_TTL ms.
 */
async function getSystemInfo() {
    if (_sysInfoCached && Date.now() - _sysInfoCached._fetchedAt < SYSINFO_CACHE_TTL) {
        console.log("[SysInfo] Memory cache hit");
        return _sysInfoCached;
    }

    console.log("[SysInfo] Collecting full system diagnostics...");

    const [osInfo, cpuInfo, memInfo, gpuInfo, ffmpegInfo, storageInfo, hwProfile] = await Promise.all([
        probeOS().catch((e) => {
            console.error("[SysInfo] OS probe:", e.message);
            return {};
        }),
        probeCPU().catch((e) => {
            console.error("[SysInfo] CPU probe:", e.message);
            return {};
        }),
        probeMemory().catch((e) => {
            console.error("[SysInfo] Mem probe:", e.message);
            return {};
        }),
        probeGPU().catch((e) => {
            console.error("[GPU] GPU probe:", e.message);
            return {};
        }),
        probeFFmpeg().catch((e) => {
            console.error("[FFmpeg] probe:", e.message);
            return { available: false };
        }),
        probeStorage().catch((e) => {
            console.error("[SysInfo] Storage probe:", e.message);
            return { drives: [] };
        }),
        detect().catch(() => ({ ...PROFILES.cpu })),
    ]);

    const networkInfo = probeNetwork();
    const runtimeInfo = probeRuntime();
    const transcodingInfo = analyzeTranscoding(hwProfile, ffmpegInfo, cpuInfo);
    const healthInfo = buildHealth(cpuInfo, memInfo, ffmpegInfo, hwProfile);

    const result = {
        _fetchedAt: Date.now(),
        _version: "1.1.0",
        os: osInfo,
        cpu: cpuInfo,
        memory: memInfo,
        gpu: gpuInfo,
        ffmpeg: ffmpegInfo,
        storage: storageInfo,
        network: networkInfo,
        runtime: runtimeInfo,
        transcoding: transcodingInfo,
        health: healthInfo,
        hwaccel: hwProfile,
    };

    _sysInfoCached = result;
    saveDiskCache(SYSINFO_CACHE_FILE, result);

    console.log("[SysInfo] Diagnostics complete");
    return result;
}

function invalidateSysInfo() {
    _sysInfoCached = null;
    deleteDiskCache(SYSINFO_CACHE_FILE);
    console.log("[SysInfo] Cache invalidated");
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 16: Public API helpers ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * getRecommendedProfile() — returns full hwaccel profile + transcoding
 * recommendation. Lazy-loads via getSystemInfo.
 */
async function getRecommendedProfile() {
    const info = await getSystemInfo();
    return {
        hwaccel: info.hwaccel,
        transcoding: info.transcoding,
        health: info.health,
    };
}

/**
 * getEncoderCapabilities() — returns encoder/decoder support matrix.
 */
async function getEncoderCapabilities() {
    const info = await getSystemInfo();
    const ff = info.ffmpeg;
    return {
        available: ff.available,
        ffmpegVersion: ff.version,
        encoders: {
            h264: {
                h264_nvenc: ff.hasNVENC,
                h264_qsv: ff.hasQSV,
                h264_vaapi: ff.hasVAAPI,
                libx264: ff.hasLibx264,
            },
            h265: {
                hevc_nvenc: ff.hasNVENC,
                hevc_qsv: ff.hasQSV,
                hevc_vaapi: ff.hasVAAPI,
                libx265: ff.hasLibx265,
            },
        },
        decoders: {
            cuda: ff.hasCudaDecoder,
        },
        hwaccels: ff.hwaccels,
        recommended: {
            h264: info.transcoding.recommendedH264Encoder,
            h265: info.transcoding.recommendedH265Encoder,
            decoder: info.transcoding.preferredDecoder,
        },
    };
}

/**
 * getFFmpegCapabilities() — raw FFmpeg capability dump.
 */
async function getFFmpegCapabilities() {
    const info = await getSystemInfo();
    return info.ffmpeg;
}

/**
 * isRealtimeCapable() — true if system can handle realtime HW transcode.
 */
async function isRealtimeCapable() {
    const info = await getSystemInfo();
    return info.transcoding.realtimeCapable === true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECTION 17: Express route handler ───────────────────────────════════════
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * getSysInfoRoute — Express handler for GET /api/sysinfo
 *
 * Usage in server.js:
 *   const { getSysInfoRoute } = require('./utils/hwAccel');
 *   app.get('/api/sysinfo', getSysInfoRoute);
 *
 * Query params:
 *   ?refresh=1  — force full re-probe
 *   ?section=cpu|gpu|ffmpeg|os|memory|storage  — partial response
 */
async function getSysInfoRoute(req, res) {
    try {
        const refresh = req.query.refresh === "1" || req.query.refresh === "true";
        if (refresh) {
            invalidateSysInfo();
            invalidate();
        }

        const info = await getSystemInfo();
        const section = req.query.section?.toLowerCase();

        // Partial section support
        if (section && info[section]) {
            return res.json({
                success: true,
                timestamp: info._fetchedAt,
                section,
                data: info[section],
            });
        }

        return res.json({
            success: true,
            timestamp: info._fetchedAt,
            version: info._version,
            hwaccel: {
                type: info.hwaccel?.type || "cpu",
                supported: info.hwaccel?.supported || false,
                profile: info.hwaccel,
            },
            system: {
                os: info.os,
                cpu: info.cpu,
                memory: info.memory,
                gpu: info.gpu,
                ffmpeg: info.ffmpeg,
                storage: info.storage,
                network: info.network,
                runtime: info.runtime,
                transcoding: info.transcoding,
                health: info.health,
            },
        });
    } catch (err) {
        console.error("[SysInfo] Route handler failed:", err);
        return res.status(500).json({
            success: false,
            timestamp: Date.now(),
            error: "System info collection failed",
            hwaccel: { type: "cpu", supported: false },
            system: {},
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── EXPORTS ──────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    // HW accel core
    detect,
    invalidate,
    getFFmpegHWDecodeArgs,
    PROFILES,

    // System info
    getSystemInfo,
    invalidateSysInfo,

    // Public API helpers (used by transcoder + stream controller)
    getRecommendedProfile,
    getEncoderCapabilities,
    getFFmpegCapabilities,
    isRealtimeCapable,

    // Express route
    getSysInfoRoute,
    getLiveMetrics,
};

function getLiveMetrics() {
    return { cpuPercent: _sysInfoCached ? _sysInfoCached.cpu.usagePercent : null, memPercent: _sysInfoCached ? _sysInfoCached.memory.usagePercent : null };
}
