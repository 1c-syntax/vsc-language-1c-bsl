import * as child_process from "child_process";
import * as fs from "fs-extra";
import * as Paths from "path";
import * as vscode from "vscode";
import {
    Executable,
    LanguageClient,
    LanguageClientOptions,
    Location as LSLocation,
    Position as LSPosition,
    ServerOptions
} from "vscode-languageclient/node";
import * as which from "which";
import { LANGUAGE_1C_BSL_CONFIG } from "../const";
import BSLLanguageServerDownloadChannel from "../util/bsllsDownloadChannel";
import { correctBinname, isOSMacOS, isOSUnix, isOSUnixoid, isOSWindows } from "../util/osUtils";
import { ServerDownloader } from "../util/serverDownloader";
import { IStatus } from "../util/status";
import { Global } from "../global";

const RESTART_COMMAND = `${LANGUAGE_1C_BSL_CONFIG}.languageServer.restart`;
const RUN_ALL_TESTS_COMMAND = `${LANGUAGE_1C_BSL_CONFIG}.languageServer.runAllTests`;
const RUN_TEST_COMMAND = `${LANGUAGE_1C_BSL_CONFIG}.languageServer.runTest`;
const DEBUG_TEST_COMMAND = `${LANGUAGE_1C_BSL_CONFIG}.languageServer.debugTest`;
const GOTO_LOCATIONS_COMMAND = `${LANGUAGE_1C_BSL_CONFIG}.languageServer.gotoLocations`;
const SHOW_REFERENCES_COMMAND = `${LANGUAGE_1C_BSL_CONFIG}.languageServer.showReferences`;

export default class LanguageClientProvider {
    private bslLsReady = false;
    private languageClient: LanguageClient;

    public async registerLanguageClient(context: vscode.ExtensionContext, status: IStatus, global: Global) {
        const configuration = vscode.workspace.getConfiguration(LANGUAGE_1C_BSL_CONFIG);
        const languageServerEnabled = Boolean(configuration.get("languageServerEnabled"));

        if (!languageServerEnabled) {
            // Ждать нечего: сервер выключен, считаем его «готовым», чтобы
            // waitForBSLLSActivation не зависал.
            this.bslLsReady = true;
            return;
        }

        let token = String(configuration.get("githubToken"));
        if (!token) {
            token = process.env.LANGUAGE_1C_BSL_GITHUB_TOKEN;
        }

        status.update("Activating BSL Language Server...");

        const baseInstallDir = String(configuration.get("languageServerBaseInstallDir")) || context.globalStoragePath;
        if (isOSWindows() && baseInstallDir.search(/[а-яёА-ЯЁ]/gm) >= 0) {
            const message = `BSL LS base install dir <${baseInstallDir}> contains cyrillic letters.
                Please override ${LANGUAGE_1C_BSL_CONFIG}.languageServerBaseInstallDir setting and set directory without cyrillic like "c:\\tools\\BSL Language Server"`;

            console.error(message);
            vscode.window.showErrorMessage(message);
            return;
        }

        const langServerInstallDir = Paths.join(
            baseInstallDir,
            "bsl-language-server"
        );

        let osPostfix: string;
        if (isOSUnix()) {
            osPostfix = "nix";
        } else if (isOSMacOS()) {
            osPostfix = "mac";
        } else if (isOSWindows()) {
            osPostfix = "win";
        } else {
            console.error(`Unsupported BSL LS platform ${process.platform}`);
            vscode.window.showErrorMessage(`Unsupported BSL LS platform ${process.platform}`);
            return;
        }

        const langServerDownloader = new ServerDownloader(
            "BSL Language Server",
            "1c-syntax",
            "bsl-language-server",
            `bsl-language-server_${osPostfix}.zip`,
            langServerInstallDir,
            token
        );

        let installedVersion: string;
            
        const needDownload = Boolean(configuration.get<BSLLanguageServerDownloadChannel>("downloadLanguageServer"));
        if (needDownload) {
            const downloadChannel = configuration.get<BSLLanguageServerDownloadChannel>("languageServerReleaseChannel");

            try {
                installedVersion = await langServerDownloader.downloadServerIfNeeded(status, downloadChannel);
            } catch (error) {
                console.error(error);
                vscode.window.showWarningMessage(
                    `Could not update/download BSL Language Server: ${error}`
                );
                return;
            }

            const files = await fs.promises.readdir(langServerInstallDir, { encoding: "utf8" });
            files
                .filter(file => file !== "SERVER-INFO")    // todo: протекло
                .filter(file => file !== installedVersion)
                .filter(file => !file.startsWith(".install-"))
                .map(file => Paths.join(langServerInstallDir, file))
                .forEach(async file => {
                    try {
                        await fs.remove(file);
                    } catch (err) {
                        vscode.window.showWarningMessage(`Can't clean up old BSL LS file ${file}:\n${err}`);
                    }
                });
        } else {
            installedVersion = await langServerDownloader.installedVersionBSLLS();
        }
        const languageServerDir = Paths.join(langServerInstallDir, installedVersion);

        status.update("Initializing BSL Language Server...");

        const binaryName = this.getBinaryName(languageServerDir);

        this.languageClient = await this.createLanguageClient(context, binaryName);
        this.languageClient.start();

        let terminal = vscode.window.terminals.find(terminal => terminal.name === "BSL Language Server tests");
        if (terminal === undefined) {
            terminal = vscode.window.createTerminal({
                name: "BSL Language Server tests",
                hideFromUser: true
            });
        } 

        type RunTestArgs = {
            text: string;
        }

        context.subscriptions.push(
            vscode.commands.registerCommand(RESTART_COMMAND, async () => {
                this.bslLsReady = false;
                await this.languageClient.stop();

                this.languageClient.start();

                // await this.languageClient.onReady();
                this.bslLsReady = true;
            }),
            vscode.commands.registerCommand(RUN_ALL_TESTS_COMMAND, async (args: RunTestArgs) => {
                terminal.show();    
                terminal.sendText(args.text);
            }),
            vscode.commands.registerCommand(RUN_TEST_COMMAND, async (args: RunTestArgs) => {
                terminal.show();
                terminal.sendText(args.text);
            }),
            vscode.commands.registerCommand(DEBUG_TEST_COMMAND, async (args: RunTestArgs) => {

                if (terminal.state.shell) {
                    terminal.show();
                    terminal.sendText(args.text);
                    vscode.commands.executeCommand("workbench.action.debug.start");
                }

            }),
            // Обёртки навигации для CodeLens-линз BSL Language Server. Встроенные команды
            // редактора ожидают нативные vscode.Uri/Position/Location, а сервер присылает их
            // сырым JSON (см. microsoft/vscode-languageserver-node#555), поэтому аргументы
            // оживляются через protocol2CodeConverter перед вызовом встроенной команды.
            vscode.commands.registerCommand(
                GOTO_LOCATIONS_COMMAND,
                async (uri: string, position: LSPosition, locations: LSLocation[], multiple: string) => {
                    const converter = this.languageClient.protocol2CodeConverter;
                    await vscode.commands.executeCommand(
                        "editor.action.goToLocations",
                        converter.asUri(uri),
                        converter.asPosition(position),
                        locations.map(location => converter.asLocation(location)),
                        multiple ?? "peek",
                        "Не найдено объявлений"
                    );
                }
            ),
            vscode.commands.registerCommand(
                SHOW_REFERENCES_COMMAND,
                async (uri: string, position: LSPosition, locations: LSLocation[]) => {
                    const converter = this.languageClient.protocol2CodeConverter;
                    await vscode.commands.executeCommand(
                        "editor.action.showReferences",
                        converter.asUri(uri),
                        converter.asPosition(position),
                        locations.map(location => converter.asLocation(location))
                    );
                }
            )
        );

        // await this.languageClient.onReady();
        this.bslLsReady = true;
        global.languageServerVersion = installedVersion;
    }

    public async stop() {

        if (!this.languageClient) {
            return undefined;
        }
        
        return this.languageClient.stop();
    }

    public isBslLsReady() {
        return this.bslLsReady;
    }

    private async createLanguageClient(
        context: vscode.ExtensionContext,
        binaryName: string
    ): Promise<LanguageClient> {
        const configuration = vscode.workspace.getConfiguration(LANGUAGE_1C_BSL_CONFIG);
        const languageServerExternalJar = Boolean(configuration.get("languageServerExternalJar"));

        const executable = languageServerExternalJar
            ? await this.getExecutableJar(context)
            : await this.getExecutableBinary(binaryName);

        const serverOptions: ServerOptions = {
            run: executable,
            debug: executable
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: [
                { scheme: "file", language: "bsl" },
                { scheme: "untitled", language: "bsl" }
            ],
            synchronize: {
                fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{os,bsl}")
            },
            traceOutputChannel: vscode.window.createOutputChannel(
                "BSL Language Server Trace Log",
                { log: true }
            )
        };

        return new LanguageClient("bsl", "BSL Language Server", serverOptions, clientOptions);
    }

    private async getExecutableJar(
        context: vscode.ExtensionContext
    ): Promise<Executable | undefined> {
        const configuration = vscode.workspace.getConfiguration(LANGUAGE_1C_BSL_CONFIG);

        let command = String(configuration.get("languageServerExternalJarJavaPath"));

        const javaInPath = which.sync(command, { nothrow: true });
        if (!javaInPath) {
            const javaPathExists = await fs.pathExists(command);
            if (!javaPathExists) {
                const errorMessage = `BSL Language Server is NOT running!\n
                Configuration error! Can't find "java" executable at: ${command}`;
                console.error(errorMessage);

                throw new Error(errorMessage);
            }
        }

        if (command.includes(" ")) {
            command = `"${command}"`;
        }

        let languageServerPath = String(configuration.get("languageServerExternalJarPath"));
        if (!Paths.isAbsolute(languageServerPath)) {
            languageServerPath = context.asAbsolutePath(languageServerPath);
        }
        if (languageServerPath.includes(" ")) {
            languageServerPath = `"${languageServerPath}"`;
        }

        const args: string[] = [];
        args.push("-jar", languageServerPath);

        const configurationFile = await this.getConfigurationFile(configuration);
        if (configurationFile) {
            args.push("-c", configurationFile);
        }

        args.push(...this.getMcpArgs(configuration));

        return {
            command,
            args,
            options: { env: this.getEnvWithJavaOpts(configuration), shell: true }
        };
    }

    private async getExecutableBinary(command: string): Promise<Executable | undefined> {
        const args: string[] = [];

        if (isOSUnixoid()) {
            child_process.exec(`chmod +x ${command}`);
        }

        const configuration = vscode.workspace.getConfiguration(LANGUAGE_1C_BSL_CONFIG);
        const configurationFile = await this.getConfigurationFile(configuration);
        if (configurationFile) {
            args.push("-c", configurationFile);
        }

        args.push(...this.getMcpArgs(configuration));

        return {
            command,
            args,
            options: { env: this.getEnvWithJavaOpts(configuration), shell: true }
        };
    }

    private getEnvWithJavaOpts(configuration: vscode.WorkspaceConfiguration): NodeJS.ProcessEnv {
        const javaOpts = String(configuration.get("languageServerJavaOpts") ?? "").trim();
        const env = { ...process.env };
        if (javaOpts) {
            const existingOpts = env._JAVA_OPTIONS ? `${env._JAVA_OPTIONS} ` : "";
            env._JAVA_OPTIONS = `${existingOpts}${javaOpts}`;
        }
        return env;
    }

    private async getConfigurationFile(configuration: vscode.WorkspaceConfiguration): Promise<string | undefined> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let configurationFile: string;
        if (!workspaceFolders) {
            return undefined;
        }

        configurationFile = Paths.join(
            workspaceFolders[0].uri.fsPath,
            String(configuration.get("languageServerConfiguration"))
        );

        const fileExists = await fs.pathExists(configurationFile);
        if (!fileExists) {
            return undefined;
        }

        if (configurationFile.includes(" ")) {
            configurationFile = `"${configurationFile}"`;
        }

        return configurationFile;
    }

    private getMcpArgs(configuration: vscode.WorkspaceConfiguration): string[] {
        const mcpEnabled = Boolean(configuration.get("languageServerMcpEnabled"));
        if (!mcpEnabled) {
            return [];
        }

        const port = String(configuration.get("languageServerMcpPort") ?? "").trim();
        if (!port) {
            const message = "BSL Language Server: MCP is enabled but port is empty (language-1c-bsl.languageServerMcpPort). MCP will not be started.";
            console.warn(message);
            void vscode.window.showWarningMessage(message);
            return [];
        }

        return ["--mcp", `--server.port=${port}`];
    }

    private getBinaryName(langServerInstallDir: string) {
        const postfix = isOSMacOS() ? ".app" : "";
        const archiveDir = `bsl-language-server${postfix}`;
        let binaryDir: string;

        if (isOSMacOS()) {
            binaryDir = Paths.join("Contents", "MacOS");
        } else if (isOSUnix()) {
            binaryDir = "bin";
        } else if (isOSWindows()) {
            binaryDir = ".";
        }

        let binaryName = Paths.resolve(
            langServerInstallDir,
            archiveDir,
            binaryDir,
            correctBinname("bsl-language-server")
        );
        if (binaryName.includes(" ")) {
            binaryName = `"${binaryName}"`;
        }

        return binaryName;
    }
}
