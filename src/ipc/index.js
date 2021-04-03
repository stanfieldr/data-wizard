import {ipcMain} from "electron";
import whyMissing from "@/backend/why-missing";

ipcMain.handle('why-missing', async function (event, args) {
    event.sender.send('why-missing-replay', await whyMissing.apply(null, args));
});