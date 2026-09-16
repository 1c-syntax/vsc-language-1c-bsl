import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export default class TaskProvider {
    public onConfigurationChanged() {
        type AutoDetect = "on" | "off";
        const autoDetect = vscode.workspace
            .getConfiguration("language-1c-bsl")
            .get<AutoDetect>("autoDetect");
        if (!vscode.workspace.workspaceFolders) {
            return;
        }
        if (autoDetect === "on") {
            vscode.tasks.registerTaskProvider("bsl", {
                provideTasks: () => {
                    return this.provideBslScripts();
                },
                resolveTask(): vscode.Task | undefined {
                    return undefined;
                }
            });
        }
    }

    private provideBslScripts(): vscode.Task[] {
        const emptyTasks: vscode.Task[] = [];
        const folders = vscode.workspace.workspaceFolders;

        if (!folders) {
            return emptyTasks;
        }

        try {
            const allTasks: vscode.Task[] = [];
            for (const folder of folders) {
                if (!this.isEnabled(folder)) {
                    continue;
                }
                allTasks.push(...this.fillDefaultTasks(folder));
                allTasks.push(...this.provideBslScriptsForFolder(folder));
            }
            return allTasks;
        } catch (e) {
            return emptyTasks;
        }
    }

    private isEnabled(folder: vscode.WorkspaceFolder): boolean {
        return (
            vscode.workspace.getConfiguration("language-1c-bsl", folder.uri).get("autoDetect") ===
            "on"
        );
    }

    private fillDefaultTasks(workspaceFolder: vscode.WorkspaceFolder) {
        const result: vscode.Task[] = [];
        result.push(
            this.createTask(
                "OneScript: compile",
                workspaceFolder,
                // tslint:disable-next-line:no-invalid-template-strings
                "oscript",
                ["-compile", "${file}"],
                ["$OneScript Linter"]
            )
        );
        result.push(
            this.createTask(
                "OneScript: check",
                workspaceFolder,
                // tslint:disable-next-line:no-invalid-template-strings
                "oscript",
                ["-check", "${file}"],
                ["$OneScript Linter"]
            )
        );
        result.push(
            this.createTask(
                "OneScript: make",
                workspaceFolder,
                // tslint:disable-next-line:no-invalid-template-strings
                "oscript",
                ["-make", "${file}", "${fileBasename}.exe"],
                ["$OneScript Linter"]
            )
        );
        result.push(
            this.createTask(
                "OneScript: run",
                workspaceFolder,
                // tslint:disable-next-line:no-invalid-template-strings
                "oscript",
                ["${file}"],
                ["$OneScript Linter"],
                true
            )
        );
        result.push(
            this.createTask(
                "1testrunner: Testing project",
                workspaceFolder,
                "cmd",
                // tslint:disable-next-line:no-invalid-template-strings
                ["1testrunner", "-runall", "${workspaceRoot}/tests"],
                ["$OneScript Linter"]
            )
        );
        result.push(
            this.createTask(
                "1testrunner: Testing current test-file",
                workspaceFolder,
                "cmd",
                // tslint:disable-next-line:no-invalid-template-strings
                ["1testrunner", "-run", "${file}"],
                ["$OneScript Linter"],
                false,
                true
            )
        );
        result.push(
            this.createTask(
                "Opm: package build",
                workspaceFolder,
                "cmd",
                // tslint:disable-next-line:no-invalid-template-strings
                ["opm", "build", "${workspaceRoot}"],
                ["$OneScript Linter"]
            )
        );
        result.push(
            this.createTask(
                "1bdd: Exec all features",
                workspaceFolder,
                "cmd",
                // tslint:disable-next-line:no-invalid-template-strings
                ["1bdd", "${workspaceRoot}/features", "-out", "${workspaceRoot}/exec.log"],
                ["$OneScript Linter"],
                true
            )
        );
        result.push(
            this.createTask(
                "1bdd: Exec feature",
                workspaceFolder,
                "cmd",
                // tslint:disable-next-line:no-invalid-template-strings
                ["1bdd", "${file}", "-fail-fast", "-require", "${workspaceRoot}/features", "-out", "${workspaceRoot}/exec.log"],
                ["$OneScript Linter"],
                false,
                true
            )
        );
        result.push(
            this.createTask(
                "1bdd: Exec feature for current step def",
                workspaceFolder,
                "cmd",
                // tslint:disable-next-line:no-invalid-template-strings
                [
                    "1bdd",
                    "${fileDirname}/../${fileBasenameNoExtension}.feature",
                    "-fail-fast",
                    "-require",
                    "${workspaceRoot}/features",
                    "-out",
                    // tslint:disable-next-line:no-invalid-template-strings
                    "${workspaceRoot}/exec.log"
                ],
                ["$OneScript Linter"],
                false,
                true
            )
        );
        result.push(
            this.createTask(
                "1bdd: Exec feature + debug",
                workspaceFolder,
                "cmd",
                // tslint:disable-next-line:no-invalid-template-strings
                [
                    "1bdd",
                    "${file}",
                    "-fail-fast",
                    "-require",
                    "${workspaceRoot}/features",
                    "-verbose",
                    "on",
                    "-out",
                    "${workspaceRoot}/exec.log"
                ],
                ["$OneScript Linter"]
            )
        );
        result.push(
            this.createTask(
                "1bdd: Generate feature steps",
                workspaceFolder,
                "cmd",
                // tslint:disable-next-line:no-invalid-template-strings
                ["1bdd", "gen", "${file}", "-out", "${workspaceRoot}/exec.log"],
                ["$OneScript Linter"]
            )
        );
        return result;
    }

    private createTask(
        label: string,
        workspaceFolder: vscode.WorkspaceFolder,
        command,
        args?: string[],
        problemMatcher?: string[],
        isBuildCommand = false,
        isTestCommand = false
    ): vscode.Task {
        const kind: vscode.TaskDefinition = {
            label,
            type: "bsl",
            args,
            problemMatcher
        };

        if (command === "cmd") {
            const isWin = /^win/.test(process.platform);
            command = isWin ? "cmd" : "sh";
            const argsWin = args.slice();
            const argsLin = args.slice();
            args.unshift(isWin ? "/c" : "-c");
            argsWin.unshift("/c");
            argsLin.unshift("-c");
            kind.windows = {
                command: "cmd",
                args: argsWin
            };
            kind.linux = {
                command: "sh",
                args: argsLin
            };
        } else {
            kind.command = command;
        }

        const task = new vscode.Task(
            kind,
            workspaceFolder,
            label,
            command,
            new vscode.ProcessExecution(command, args, { cwd: workspaceFolder.uri.fsPath }),
            problemMatcher
        );

        if (isBuildCommand) {
            task.group = vscode.TaskGroup.Build;
        }
        if (isTestCommand) {
            task.group = vscode.TaskGroup.Test;
        }

        // task.detail = `${command} ${args.join(" ")}` ;

        return task;
    }

    private provideBslScriptsForFolder(workspaceFolder: vscode.WorkspaceFolder): vscode.Task[] {
        const emptyTasks: vscode.Task[] = [];
        const tasksFolder = path.join(workspaceFolder.uri.fsPath, "tasks");

        if (!fs.existsSync(tasksFolder)) {
            return emptyTasks;
        }

        try {
            const result: vscode.Task[] = [];
            const taskFiles = fs.readdirSync(tasksFolder);
            for (const taskFile of taskFiles) {
                const filename = path.join(tasksFolder, taskFile);
                const stat = fs.lstatSync(filename);
                if (stat.isDirectory()) {
                    continue;
                }
                const label = taskFile;
                result.push(
                    this.createTask(
                        "Execute task: " + label,
                        // tslint:disable-next-line:no-invalid-template-strings
                        workspaceFolder,
                        "cmd",
                        ["oscript", "${workspaceRoot}/tasks/" + label],
                        ["$OneScript Linter"],
                        true
                    )
                );
            }
            return result;
        } catch (e) {
            return emptyTasks;
        }
    }
}
