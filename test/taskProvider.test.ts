import * as path from "path";
import "should";
import * as vscode from "vscode";

import { fixturePath, newTextDocument } from "./helpers";

describe("Task provider", () => {

    before(async () => {
        const uriFile = vscode.Uri.file(
            path.join(fixturePath, "CommonModules", "CommonModule", "Ext", "Module.bsl")
        );
        await newTextDocument(uriFile);
        const extension = vscode.extensions.getExtension("1c-syntax.language-1c-bsl");
        await extension.activate();
    });

    it("should provide default tasks without an active editor", async () => {
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        Boolean(vscode.window.activeTextEditor).should.be.false();

        const tasks = await vscode.tasks.fetchTasks({ type: "bsl" });

        tasks.should.be.an.Array();
        tasks.length.should.be.greaterThan(0);
        tasks.should.matchAny((task: vscode.Task) => {
            task.name.should.equal("OneScript: compile");
            task.definition.type.should.equal("bsl");
        });
    });

    it("should provide default tasks when a workspace file is active", async () => {
        const uriFile = vscode.Uri.file(
            path.join(fixturePath, "CommonModules", "CommonModule", "Ext", "Module.bsl")
        );
        await newTextDocument(uriFile);

        const tasks = await vscode.tasks.fetchTasks({ type: "bsl" });

        tasks.should.matchAny((task: vscode.Task) => {
            task.name.should.equal("OneScript: compile");
        });
    });

});
