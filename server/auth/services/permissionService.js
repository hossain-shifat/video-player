"use strict";

/**
 * auth/services/permissionService.js
 * Helpers to read/write user permissions and filter media by permissions.
 * All filtering happens at request level via req.user — no extra DB queries.
 */

const DEFAULT_PERMISSIONS = {
    libraries: [],       // empty = no access; admin auto-gets all
    allowAdult: false,
    canDownload: false,
    canLiveTV: true,
    maxQuality: "1080p",
};

/**
 * Parse permissionsJson string from DB into object.
 */
function parsePermissions(permissionsJson) {
    try {
        return { ...DEFAULT_PERMISSIONS, ...JSON.parse(permissionsJson) };
    } catch {
        return { ...DEFAULT_PERMISSIONS };
    }
}

/**
 * Serialize permissions object to JSON string for DB storage.
 */
function serializePermissions(perms) {
    return JSON.stringify({ ...DEFAULT_PERMISSIONS, ...perms });
}

/**
 * Check if a user has access to a specific library folder.
 * Admin = always yes.
 * User with empty libraries array = no access to any library.
 * User with populated array = access only to listed library IDs.
 */
function hasLibraryAccess(user, libraryId) {
    if (user.role === "admin") return true;
    const perms = parsePermissions(user.permissionsJson);
    if (!perms.libraries || perms.libraries.length === 0) return false;
    return perms.libraries.includes(libraryId);
}

/**
 * Filter a list of library folders to only those the user can access.
 */
function filterLibraries(user, folders) {
    if (user.role === "admin") return folders;
    const perms = parsePermissions(user.permissionsJson);
    if (!perms.libraries || perms.libraries.length === 0) return [];
    return folders.filter((f) => perms.libraries.includes(f.id) || perms.libraries.includes(f.label));
}

/**
 * Filter a list of media items by user permissions:
 *   - Remove items from inaccessible libraries
 *   - Remove adult items if allowAdult === false
 */
function filterMedia(user, items) {
    if (user.role === "admin") return items;
    const perms = parsePermissions(user.permissionsJson);

    return items.filter((item) => {
        // Adult filter
        if (!perms.allowAdult && item.isAdult) return false;

        // Library filter — only apply if libraries list is set
        if (perms.libraries && perms.libraries.length > 0) {
            if (item.folderId && !perms.libraries.includes(item.folderId)) return false;
            if (item.library && !perms.libraries.includes(item.library)) return false;
        }

        return true;
    });
}

module.exports = { parsePermissions, serializePermissions, hasLibraryAccess, filterLibraries, filterMedia, DEFAULT_PERMISSIONS };
