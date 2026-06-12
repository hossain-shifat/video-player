// web/src/hooks/useLibrary.js
// TanStack Query hooks for library (folder management) endpoints.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getFolders, addFolder, updateFolder, removeFolder } from "../api/library";
import { MEDIA_KEYS } from "./useMedia";

// ─── Query keys ───────────────────────────────────────────────────────────────
export const LIBRARY_KEYS = {
    all: ["library"],
    folders: () => ["library", "folders"],
};

/**
 * useLibrary() — fetches all saved folders from /api/library
 */
export function useLibrary(options = {}) {
    return useQuery({
        queryKey: LIBRARY_KEYS.folders(),
        queryFn: getFolders,
        select: (data) => data?.folders ?? [],
        staleTime: 5 * 60 * 1000, // folders rarely change
        ...options,
    });
}

/**
 * useAddFolder() — mutation to add a new library folder
 * Optimistically updates folder list; invalidates media on success.
 */
export function useAddFolder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ path, label }) => addFolder(path, label),
        onSuccess: (data) => {
            // Optimistically append to folder list
            qc.setQueryData(LIBRARY_KEYS.folders(), (old) => {
                const folders = old?.folders ?? [];
                return { folders: [...folders, data.folder] };
            });
            // Invalidate media — new folder may have new files
            qc.invalidateQueries({ queryKey: MEDIA_KEYS.all });
        },
    });
}

/**
 * useUpdateFolder() — mutation to update a folder's label or path
 */
export function useUpdateFolder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, updates }) => updateFolder(id, updates),
        onSuccess: (data) => {
            qc.setQueryData(LIBRARY_KEYS.folders(), (old) => {
                const folders = (old?.folders ?? []).map((f) => (f.id === data.folder.id ? data.folder : f));
                return { folders };
            });
            qc.invalidateQueries({ queryKey: MEDIA_KEYS.all });
        },
    });
}

/**
 * useRemoveFolder() — mutation to remove a folder
 */
export function useRemoveFolder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => removeFolder(id),
        onSuccess: (_, id) => {
            qc.setQueryData(LIBRARY_KEYS.folders(), (old) => {
                const folders = (old?.folders ?? []).filter((f) => f.id !== id);
                return { folders };
            });
            qc.invalidateQueries({ queryKey: MEDIA_KEYS.all });
        },
    });
}
