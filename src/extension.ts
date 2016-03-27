// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { BSL_MODE } from "./const";
import {Global} from "./global";
import CompletionItemProvider from "./features/completionItemProvider";
import DefinitionProvider from "./features/definitionProvider";
import LintProvider from "./features/lintProvider";
import DocumentSymbolProvider from "./features/documentSymbolProvider";
import WorkspaseSymbolProvider from "./features/workspaceSymbolProvider";
import ReferenceProvider from "./features/referenceProvider";

let diagnosticCollection: vscode.DiagnosticCollection;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    const global = new Global("global");
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(BSL_MODE, new CompletionItemProvider(global), ".", "="));
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(BSL_MODE, new DefinitionProvider(global)));
    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(BSL_MODE, new DocumentSymbolProvider(global)));
    context.subscriptions.push(vscode.languages.registerReferenceProvider(BSL_MODE, new ReferenceProvider(global)));
    context.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(new WorkspaseSymbolProvider(global)));
    let linter = new LintProvider();
    linter.activate(context.subscriptions);

    context.subscriptions.push(vscode.commands.registerCommand("language-1c-bsl.update", () => {
        let filename = vscode.window.activeTextEditor.document.fileName;
        global.updateCache(filename);
    }));

    vscode.languages.setLanguageConfiguration("bsl", {
        indentationRules: {
            decreaseIndentPattern: /^\s*(конецесли|конеццикла|конецпроцедуры|конецфункции|иначе|иначеесли|конецпопытки|исключение|endif|enddo|endprocedure|endfunction|else|elseif|endtry|except).*$/i,
            increaseIndentPattern: /^\s*(пока|процедура|функция|если|иначе|иначеесли|попытка|исключение|для|while|procedure|function|if|else|elseif|try|for)[^;]*$/i
        },
        comments: {
            lineComment: "//"
        },
        brackets: [
            ["{", "}"],
            ["[", "]"],
            ["(", ")"]
        ],
        onEnterRules: [
            {
                beforeText: /^\s*\|([^\"]|"[^\"]*")*$/,
                action: { indentAction: vscode.IndentAction.None, appendText: "|" }
            },
            {
                beforeText: /^([^\|\"]|"[^\"]*")*\"[^\"]*$/,
                action: { indentAction: vscode.IndentAction.None, appendText: "|" }
            }
        ]
    });

    vscode.languages.setLanguageConfiguration("sdbl", {

        comments: {
            lineComment: "//"
        },
        brackets: [
            ["{", "}"],
            ["[", "]"],
            ["(", ")"]
        ]
    });

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(function (textEditor: vscode.TextEditor) {
        applyConfigToTextEditor(textEditor);
    }));
    if (vscode.window.activeTextEditor) {
        applyConfigToTextEditor(vscode.window.activeTextEditor);
    }
}

function applyConfigToTextEditor(textEditor: vscode.TextEditor): any {

    if (!textEditor) {
        return ;
    };
    let  newOptions: vscode.TextEditorOptions = {
        "insertSpaces" : false,
        "tabSize" : 4
    };

    let defaultOptions: vscode.TextEditorOptions = {
        "insertSpaces" : Boolean(vscode.workspace.getConfiguration("editor").get("insertSpaces")),
        "tabSize" : Number(vscode.workspace.getConfiguration("editor").get("tabSize"))
    };

    if (vscode.languages.match(BSL_MODE, textEditor.document)) {
        if (textEditor.options.insertSpaces === defaultOptions.insertSpaces
            && (textEditor.options.tabSize === defaultOptions.tabSize)) {
                textEditor.options = newOptions;
        } else if (textEditor.options.insertSpaces === newOptions.insertSpaces && textEditor.options.tabSize === newOptions.tabSize) {
            textEditor.options = defaultOptions;
        }
    }
}