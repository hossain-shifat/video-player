// web/src/dashboard/upload/useUploadQueue.js
//
// Thin React binding over the uploadManager singleton. The component owns
// NO queue state of its own anymore — this hook just mirrors whatever the
// manager currently has, so a mount/unmount/refresh of this page never loses
// or interrupts anything the manager is doing.

import { useEffect, useState } from "react";
import { uploadManager } from "./uploadManager";

export function useUploadQueue() {
    const [queue, setQueue] = useState(() => uploadManager.getQueue());
    useEffect(() => {
        console.log(`[useUploadQueue] mounted — talking to uploadManager instance ${uploadManager._instanceId}, initial snapshot has ${uploadManager.getQueue().length} item(s)`);
        return uploadManager.subscribe((snapshot) => {
            console.log(`[useUploadQueue] notified by instance ${uploadManager._instanceId} — ${snapshot.length} item(s)`);
            setQueue(snapshot);
        });
    }, []);
    return queue;
}
