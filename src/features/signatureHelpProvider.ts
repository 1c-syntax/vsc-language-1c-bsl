/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {SignatureHelpProvider, SignatureHelp, SignatureInformation, CancellationToken, TextDocument, Position, workspace} from "vscode";
import AbstractProvider from "./abstractProvider";
import bslGlobals = require("./bslGlobals");


let _NL = "\n".charCodeAt(0);
let _TAB = "\t".charCodeAt(0);
let _WSB = " ".charCodeAt(0);
let _LBracket = "[".charCodeAt(0);
let _RBracket = "]".charCodeAt(0);
let _LCurly = "{".charCodeAt(0);
let _RCurly = "}".charCodeAt(0);
let _LParent = "(".charCodeAt(0);
let _RParent = ")".charCodeAt(0);
let _Comma = ",".charCodeAt(0);
let _Quote = "'".charCodeAt(0);
let _DQuote = "\"".charCodeAt(0);
let _USC = "_".charCodeAt(0);
let _a = "a".charCodeAt(0);
let _z = "z".charCodeAt(0);
let _A = "A".charCodeAt(0);
let _Z = "Z".charCodeAt(0);
let _0 = "0".charCodeAt(0);
let _9 = "9".charCodeAt(0);
let _Dot = ".".charCodeAt(0);

let BOF = 0;


class BackwardIterator {
    private lineNumber: number;
    private offset: number;
    private line: string;
    private model: TextDocument;

    constructor(model: TextDocument, offset: number, lineNumber: number) {
        this.lineNumber = lineNumber;
        this.offset = offset;
        this.line = model.lineAt(this.lineNumber).text;
        this.model = model;
    }

    public hasNext(): boolean {
        return this.lineNumber >= 0;
    }

    public next(): number {
        if (this.offset < 0) {
            if (this.lineNumber > 0) {
                this.lineNumber--;
                this.line = this.model.lineAt(this.lineNumber).text;
                this.offset = this.line.length - 1;
                return _NL;
            }
            this.lineNumber = -1;
            return BOF;
        }
        let ch = this.line.charCodeAt(this.offset);
        this.offset--;
        return ch;
    }

}


export default class GlobalSignatureHelpProvider extends AbstractProvider implements SignatureHelpProvider {

    public provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken): SignatureHelp {
        let iterator = new BackwardIterator(document, position.character - 1, position.line);

        let paramCount = this.readArguments(iterator);
        if (paramCount < 0) {
            return null;
        }

        let ident = this.readIdent(iterator);
        if (!ident) {
            return null;
        }

        let entry = this._global.globalfunctions[ident.toLowerCase()];
        if (!entry || !entry.signature) {
            let module = "";
            if (ident.indexOf(".") > 0) {
                let dotArray: Array<string> = ident.split(".");
                ident = dotArray.pop();
                module = dotArray.join(".");
            }
            if (module.length === 0) {
                let source = document.getText();
                entry = this._global.getCacheLocal(document.fileName, ident, source);
            } else {
                entry = this._global.query(ident, module, false, false);
            }
            if (entry.length === 0) {
                entry = this._global.query(ident, "", false, false);
            }
            if (!entry) {
                return null;
            } else {
                entry = entry[0];
                if (entry._method.Params.length !== 0) {
                    let arraySignature = this._global.GetSignature(entry);
                    let ret = new SignatureHelp();
                    let signatureInfo = new SignatureInformation(entry.name + arraySignature.paramsString, "");

                    let re = /([\wа-яА-Я]+)(:\s+[<а-яА-Я\w_\.>]+)?/g;
                    let match: RegExpExecArray = null;
                    while ((match = re.exec(arraySignature.paramsString)) !== null) {
                        let documentationParam = this._global.GetDocParam(arraySignature.description, match[1]);
                        signatureInfo.parameters.push({ label: match[0] + (documentationParam.optional ? "?" : ""), documentation: documentationParam.descriptionParam });
                    }

                    if (entry._method.Params.length - 1 < paramCount) {
                        return null;
                    }

                    ret.signatures.push(signatureInfo);
                    // ret.activeSignature = 0;
                    ret.activeParameter = Math.min(paramCount, signatureInfo.parameters.length - 1);

                    return ret;
                } else {
                    return null;
                }
            }
        }
        let ret = new SignatureHelp();
        for (let element in entry.signature) {
            // var paramsCount = entry.signature[element].Параметры
            let paramsString = entry.signature[element].СтрокаПараметров;
            let signatureInfo = new SignatureInformation(entry.name + paramsString, "");

            let re = /([\wа-яА-Я]+)\??:\s+[а-яА-Я\w_\.]+/g;
            let match: RegExpExecArray = null;
            while ((match = re.exec(paramsString)) !== null) {
                signatureInfo.parameters.push({ label: match[0], documentation: entry.signature[element].Параметры[match[1]] });
            }

            if (signatureInfo.parameters.length - 1 < paramCount) {
                continue;
            }
            ret.signatures.push(signatureInfo);
            // ret.activeSignature = 0;
            ret.activeParameter = Math.min(paramCount, signatureInfo.parameters.length - 1);

        }
        return ret;
    }



    private readArguments(iterator: BackwardIterator): number {
        let parentNesting = 0;
        let bracketNesting = 0;
        let curlyNesting = 0;
        let paramCount = 0;
        while (iterator.hasNext()) {
            let ch = iterator.next();
            switch (ch) {
                case _LParent:
                    parentNesting--;
                    if (parentNesting < 0) {
                        return paramCount;
                    }
                    break;
                case _RParent: parentNesting++; break;
                case _LCurly: curlyNesting--; break;
                case _RCurly: curlyNesting++; break;
                case _LBracket: bracketNesting--; break;
                case _RBracket: bracketNesting++; break;
                case _DQuote:
                case _Quote:
                    // while (iterator.hasNext() && ch !== iterator.next()) {
                    //     // find the closing quote or double quote
                    // }
                    break;
                case _Comma:
                    if (!parentNesting && !bracketNesting && !curlyNesting) {
                        paramCount++;
                    }
                    break;
            }
        }
        return -1;
    }

    private isIdentPart(ch: number): boolean {
        if (ch === _USC || // _
            ch >= _a && ch <= _z || // a-z
            ch >= _A && ch <= _Z || // A-Z
            ch >= _0 && ch <= _9 || // 0/9
            ch === _Dot ||
            ch >= 0x80 && ch <= 0xFFFF) { // nonascii

            return true;
        }
        return false;
    }

    private readIdent(iterator: BackwardIterator): string {
        let identStarted = false;
        let ident = "";
        while (iterator.hasNext()) {
            let ch = iterator.next();
            if (!identStarted && (ch === _WSB || ch === _TAB || ch === _NL)) {
                continue;
            }
            if (this.isIdentPart(ch)) {
                identStarted = true;
                ident = String.fromCharCode(ch) + ident;
            } else if (identStarted) {
                return ident;
            }
        }
        return ident;
    }

}
