import { contextBridge } from "electron";

// The renderer talks to the embedded Express server over fetch, exactly like the
// web build does — so it needs no privileged bridge. We expose only inert info.
contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
});
