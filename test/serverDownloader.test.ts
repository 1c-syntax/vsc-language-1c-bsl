import * as assert from "assert";
import * as fs from "fs-extra";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { Writable } from "stream";
import BSLLanguageServerDownloadChannel from "../src/util/bsllsDownloadChannel";
import { download } from "../src/util/downloadUtils";
import { ServerDownloader } from "../src/util/serverDownloader";

describe("Server downloads", function () {
    this.timeout(10000);

    let temporaryDir: string;
    let installDir: string;
    let server: http.Server;
    let url: string;
    let responseBody: Buffer;

    beforeEach(async () => {
        temporaryDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bsl-download-test-"));
        installDir = path.join(temporaryDir, "servers");
        responseBody = await fs.promises.readFile(
            path.join(__dirname, "../../test/fixtures/server-readonly.zip")
        );
        server = http.createServer((_request, response) => {
            response.writeHead(200, { "Content-Length": responseBody.length });
            response.end(responseBody);
        });
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("HTTP test server has no TCP address");
        }
        url = `http://127.0.0.1:${address.port}/server.zip`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
        await fs.remove(temporaryDir);
    });

    function createDownloader(): ServerDownloader {
        const downloader = new ServerDownloader(
            "BSL Language Server", "test", "test", "server.zip", installDir, ""
        );
        (downloader as any).latestStableReleaseInfo = async () => ({
            tag_name: "v1.0.1",
            assets: [{ name: "server.zip", browser_download_url: url }]
        });
        return downloader;
    }

    async function preparePreviousInstallation(): Promise<string> {
        const executable = path.join(installDir, "v1.0.1/bsl-language-server/bsl-language-server.exe");
        await fs.outputFile(executable, "previous incomplete installation");
        await fs.promises.chmod(executable, 0o444);
        await fs.outputFile(path.join(installDir, "v1.0.0/previous.txt"), "previous working server");
        await fs.writeJson(path.join(installDir, "SERVER-INFO"), {
            version: "v1.0.0", lastUpdate: 0
        });
        return executable;
    }

    it("recovers a previous extraction containing a read-only executable", async () => {
        const executable = await preparePreviousInstallation();
        const downloader = createDownloader();

        for (let attempt = 0; attempt < 2; attempt++) {
            await fs.writeJson(path.join(installDir, "SERVER-INFO"), {
                version: "v1.0.0", lastUpdate: 0
            });
            const version = await downloader.downloadServerIfNeeded(
                { update: () => {} }, BSLLanguageServerDownloadChannel.Stable
            );
            assert.strictEqual(version, "v1.0.1");
            assert.strictEqual(await fs.promises.readFile(executable, "utf8"), "updated server");
            assert.strictEqual((await fs.readJson(path.join(installDir, "SERVER-INFO"))).version, "v1.0.1");
        }

        assert.strictEqual(
            await fs.promises.readFile(path.join(installDir, "v1.0.0/previous.txt"), "utf8"),
            "previous working server"
        );
        assert.deepStrictEqual((await fs.promises.readdir(installDir)).sort(), [
            "SERVER-INFO", "v1.0.0", "v1.0.1"
        ]);
    });

    it("preserves the previous installation and version when an archive is invalid", async () => {
        const executable = await preparePreviousInstallation();
        responseBody = Buffer.from("invalid ZIP archive");

        await assert.rejects(createDownloader().downloadServerIfNeeded(
            { update: () => {} }, BSLLanguageServerDownloadChannel.Stable
        ));

        assert.strictEqual(
            await fs.promises.readFile(executable, "utf8"), "previous incomplete installation"
        );
        assert.deepStrictEqual(await fs.readJson(path.join(installDir, "SERVER-INFO")), {
            version: "v1.0.0", lastUpdate: 0
        });
        assert.deepStrictEqual((await fs.promises.readdir(installDir)).sort(), [
            "SERVER-INFO", "v1.0.0", "v1.0.1"
        ]);
    });

    it("waits for destination writes to finish", async () => {
        const nativeFs = require("fs");
        const original = nativeFs.createWriteStream;
        const destination = path.join(temporaryDir, "delayed.zip");
        let releaseWrite: () => void;
        let reportWriteStarted: () => void;
        const writeStarted = new Promise<void>(resolve => reportWriteStarted = resolve);
        const output = new Writable({
            write(_chunk, _encoding, callback) {
                releaseWrite = callback;
                reportWriteStarted();
            }
        });
        nativeFs.createWriteStream = (file, ...args) => file === destination
            ? output : original.call(nativeFs, file, ...args);

        try {
            let settled = false;
            const result = download(url, destination, () => {});
            result.then(() => settled = true, () => settled = true);
            await writeStarted;
            await new Promise(resolve => setTimeout(resolve, 100));
            assert.strictEqual(settled, false, "download resolved before the file was written");
            releaseWrite();
            releaseWrite = undefined;
            await result;
            assert.strictEqual(output.writableFinished, true);
        } finally {
            nativeFs.createWriteStream = original;
            if (releaseWrite) {
                releaseWrite();
            }
            output.destroy();
        }
    });

    it("rejects destination write errors", async () => {
        await assert.rejects(
            download(url, path.join(temporaryDir, "missing/destination.zip"), () => {}),
            { code: "ENOENT" }
        );
    });
});
