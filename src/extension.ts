'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import {mkdir} from 'shelljs';
import * as clipboard from 'clipboardy'
import {spawn} from 'child_process';
import * as moment from 'moment';

export function activate(context: vscode.ExtensionContext) {
    console.log('"vscode-markdown-paste" is now active!');
    context.subscriptions.push(vscode.commands.registerCommand(
        'extension.MarkdownPaste', () => {
            console.log('Paster.pasteText');
            Paster.pasteText();
        }));
    context.subscriptions.push(vscode.commands.registerCommand(
        'extension.MarkdownRuby', () => {
            Paster.Ruby();
        }));
}

export function deactivate() {
    console.log('"vscode-markdown-paste" is now deactivate!');
}

class Paster {
    static PATH_VARIABLE_CURRNET_FILE_DIR = /\$\{currentFileDir\}/;
    static PATH_VARIABLE_PROJECT_ROOT = /\$\{projectRoot\}/;
    static PATH_VARIABLE_CURRNET_FILE_NAME = /\$\{currentFileName\}/;
    static PATH_VARIABLE_CURRNET_FILE_NAME_WITHOUT_EXT = /\$\{currentFileNameWithoutExt\}/;

    static folderPathFromConfig: string;
    static basePathFromConfig: string;
    static prefixFromConfig: string;
    static suffixFromConfig: string;

    public static pasteText() {
        var content = clipboard.readSync();
        console.log('you paste:', content)
        if (content) {
            let newContent = Paster.parse(content);
            Paster.writeToEditor(newContent);
        } else {
            // if no any content in clipboard, may be a image in clipboard.
            // So try it.
            Paster.pasteImage();
        }
    }

    public static Ruby() {
        let editor = vscode.window.activeTextEditor;
        if (!editor) return;
        let rubyTag = new vscode.SnippetString("<ruby>${TM_SELECTED_TEXT}<rp>(</rp><rt>${1:pronunciation}</rt><rp>)</rp></ruby>");
        editor.insertSnippet(rubyTag);
    }

    private static isHTML(content) {
        return /<[a-z][\s\S]*>/i.test(content);
    }

    private static writeToEditor(content): Thenable < boolean > {
        let startLine = vscode.window.activeTextEditor.selection.start.line;
        var selection = vscode.window.activeTextEditor.selection
        let position = new vscode.Position(startLine, selection.start.character);
        return vscode.window.activeTextEditor.edit((editBuilder) => {
            editBuilder.insert(position, content);
        });
    }

    protected static saveImage(inputVal) {
        if (!inputVal) return;

        let editor = vscode.window.activeTextEditor;
        if (!editor) return;

        let fileUri = editor.document.uri;
        if (!fileUri) return;

        let filePath = fileUri.fsPath;

        // User may be input a path with backward slashes (\), so need to replace all '\' to '/'.
        inputVal = inputVal.replace(
            "${projectRoot}", vscode.workspace.rootPath).replace(/\\/g, '/');

        if (inputVal && (inputVal.length !== inputVal.trim().length)) {
            vscode.window.showErrorMessage('The specified path is invalid: "' + inputVal + '"');
            return;
        }

        this.createImageDirWithImagePath(inputVal).then(imgPath => {
            // save image and insert to current edit file
            this.saveClipboardImageToFileAndGetPath(imgPath, imagePath => {
                if (!imagePath) return;
                if (imagePath === 'no image') {
                    vscode.window.showInformationMessage('There is not a image in clipboard.');
                    return;
                }

                // imagePath = this.renderFilePath(editor.document.languageId, filePath, imagePath);
                imagePath = this.renderFilePath(editor.document.languageId, this.basePathFromConfig, imagePath, this.prefixFromConfig, this.suffixFromConfig);

                editor.edit(edit => {
                    let current = editor.selection;

                    if (current.isEmpty) {
                        edit.insert(current.start, imagePath);
                    } else {
                        edit.replace(current, imagePath);
                    }
                });
            });
        }).catch(err => {
            vscode.window.showErrorMessage('Make folder failed:' + inputVal);
            return;
        });
    }

    private static parse(content) {
        let rules = vscode.workspace.getConfiguration('MarkdownPaste').rules;
        let editor = vscode.window.activeTextEditor;
        let selection = editor.selection;
        let selectText = editor.document.getText(selection) || "";
        for (var i = 0; i < rules.length; i++) {
            let rule = rules[i];
            var re = new RegExp(rule.regex, rule.options);
            var reps = rule.replace;
            if (re.test(content)) {
                var newstr = content.replace(re, reps).replace("${selectText}", selectText);
                if (selectText) {
                    editor.edit(builder => {
                        builder.replace(selection, newstr);
                    });
                }
                return newstr;
            }
        }

        if (Paster.isHTML(content)) {
            var toMarkdown = require("to-markdown");
            return toMarkdown(content);
        }

        return content;
    }

    private static pasteImage() {
        // get current edit file path
        let editor = vscode.window.activeTextEditor;
        if (!editor) return;

        let fileUri = editor.document.uri;
        if (!fileUri) return;
        if (fileUri.scheme === 'untitled') {
            vscode.window.showInformationMessage('Before paste image, you need to save current edit file first.');
            return;
        }

        let filePath = fileUri.fsPath;
        let projectPath = vscode.workspace.rootPath;

        // get selection as image file name, need check
        var selection = editor.selection;
        var selectText = editor.document.getText(selection);

        if (selectText && !/^[a-z_A-Z\-\s0-9\.\\\/]+$/.test(selectText)) {
            vscode.window.showInformationMessage('Your selection is not a valid file name!');
            return;
        }

        // load config pasteImage.path/pasteImage.basePath
        this.folderPathFromConfig = vscode.workspace.getConfiguration('pasteImage')['path'];
        if (!this.folderPathFromConfig) {
            this.folderPathFromConfig = "${currentFileDir}";
        }
        if (this.folderPathFromConfig.length !== this.folderPathFromConfig.trim().length) {
            vscode.window.showInformationMessage(`The config pasteImage.path = '${this.folderPathFromConfig}' is invalid. please check your config.`);
            return;
        }
        this.basePathFromConfig = vscode.workspace.getConfiguration('pasteImage')['basePath'];
        if (!this.basePathFromConfig) {
            this.basePathFromConfig = "";
        }
        if (this.basePathFromConfig.length !== this.basePathFromConfig.trim().length) {
            vscode.window.showInformationMessage(`The config pasteImage.path = '${this.basePathFromConfig}' is invalid. please check your config.`);
            return;
        }
        this.prefixFromConfig = vscode.workspace.getConfiguration('pasteImage')['prefix'];
        this.suffixFromConfig = vscode.workspace.getConfiguration('pasteImage')['suffix'];

        this.folderPathFromConfig = this.replacePathVariable(this.folderPathFromConfig, projectPath, filePath);
        this.basePathFromConfig = this.replacePathVariable(this.basePathFromConfig, projectPath, filePath);

        if (this.folderPathFromConfig && (this.folderPathFromConfig.length !== this.folderPathFromConfig.trim().length)) {
            vscode.window.showErrorMessage('The specified path is invalid: "' + this.folderPathFromConfig + '"');
            return;
        }

        let imagePath = this.getImagePath(
            fileUri.fsPath, selectText, this.folderPathFromConfig);
        let fileNameLength = selectText ? selectText.length : 19; // yyyy-mm-dd-hh-mm-ss

        let silence = vscode.workspace.getConfiguration('pasteImage').silence;
        if (silence) {
            Paster.saveImage(imagePath);
        } else {
            let options: vscode.InputBoxOptions = {
                prompt: "You can change the filename, exist file will be overwrite!.",
                value: imagePath,
                placeHolder: "(e.g:../test/myimage.png)",
                valueSelection: [imagePath.length - 4 - fileNameLength, imagePath.length - 4],
            }
            vscode.window.showInputBox(options).then(inputVal => {
                Paster.saveImage(inputVal);
            });
        }
    }

    public static getImagePath(filePath: string, selectText: string, folderPathFromConfig: string): string {
        // image file name
        let imageFileName = "";
        if (!selectText) {
            imageFileName = moment().format("Y-MM-DD-HH-mm-ss") + ".png";
        } else {
            imageFileName = selectText + ".png";
        }

        // image output path
        let folderPath = path.dirname(filePath);
        let imagePath = "";

        // generate image path
        if (path.isAbsolute(folderPathFromConfig)) {
            // important: replace must be done at the end, path.join() will build a path with backward slashes (\)
            imagePath = path.join(folderPathFromConfig, imageFileName).replace(/\\/g, '/');
        } else {
            // important: replace must be done at the end, path.join() will build a path with backward slashes (\)
            imagePath = path.join(folderPath, folderPathFromConfig, imageFileName).replace(/\\/g, '/');
        }

        return imagePath;
    }

    /**
     * create directory for image when directory does not exist
     */
    private static createImageDirWithImagePath(imagePath: string) {
        return new Promise((resolve, reject) => {
            let imageDir = path.dirname(imagePath).replace(/\\/g, '/');

            try {
                mkdir('-p', imageDir);
            } catch (error) {
                console.log(error);
                reject(error);
                return;
            }
            resolve(imagePath);
        });
    }

    /**
     * use applescript to save image from clipboard and get file path
     */
    private static saveClipboardImageToFileAndGetPath(imagePath, cb: (imagePath: string) => void) {
        if (!imagePath) return;

        let platform = process.platform;
        if (platform === 'win32') {
            // Windows
            const scriptPath = path.join(__dirname, '../res/pc.ps1');
            const powershell = spawn('powershell', [
                '-noprofile',
                '-noninteractive',
                '-nologo',
                '-sta',
                '-executionpolicy', 'unrestricted',
                '-windowstyle', 'hidden',
                '-file', scriptPath,
                imagePath
            ]);
            powershell.on('exit', function (code, signal) {
                // console.log('exit', code, signal);
            });
            powershell.stdout.on('data', function (data: Buffer) {
                cb(data.toString().trim());
            });
        } else if (platform === 'darwin') {
            // Mac
            let scriptPath = path.join(__dirname, '../res/mac.applescript');

            let ascript = spawn('osascript', [scriptPath, imagePath]);
            ascript.on('exit', function (code, signal) {
                // console.log('exit',code,signal);
            });

            ascript.stdout.on('data', function (data: Buffer) {
                cb(data.toString().trim());
            });
        } else {
            // Linux 

            let scriptPath = path.join(__dirname, '../res/linux.sh');

            let ascript = spawn('sh', [scriptPath, imagePath]);
            ascript.on('exit', function (code, signal) {
                // console.log('exit',code,signal);
            });

            ascript.stdout.on('data', function (data: Buffer) {
                let result = data.toString().trim();
                if (result == "no xclip") {
                    vscode.window.showInformationMessage('You need to install xclip command first.');
                    return;
                }
                cb(result);
            });
        }
    }

    /**
     * render the image file path dependen on file type
     * e.g. in markdown image file path will render to ![](path)
     */
    // public static renderFilePath(languageId: string, docPath: string, imageFilePath: string): string {
    //     // relative will be add backslash characters so need to replace '\' to '/' here.
    //     imageFilePath = path.relative(path.dirname(docPath), imageFilePath).replace(/\\/g, '/');

    //     if (languageId === 'markdown') {
    //         return `![](${imageFilePath})`;
    //     } else {
    //         return imageFilePath;
    //     }
    // }
    public static renderFilePath(languageId: string, basePath: string, imageFilePath: string, prefix: string, suffix: string): string {
        if (basePath) {
             // relative will be add backslash characters so need to replace '\' to '/' here.
            imageFilePath = path.relative(basePath, imageFilePath).replace(/\\/g, '/')
        }

        imageFilePath = `${prefix}${imageFilePath}`;

        switch (languageId) {
            case "markdown":
                return `![](${imageFilePath})`
            case "asciidoc":
                return `image::${imageFilePath}[]`
            default:
                return imageFilePath;
        }
    }

    public static replacePathVariable(pathStr: string, projectRoot: string, curFilePath: string): string {
        let currentFileDir = path.dirname(curFilePath);
        let ext = path.extname(curFilePath);
        let fileName = path.basename(curFilePath);
        let fileNameWithoutExt = path.basename(curFilePath, ext);

        pathStr = pathStr.replace(this.PATH_VARIABLE_PROJECT_ROOT, projectRoot);
        pathStr = pathStr.replace(this.PATH_VARIABLE_CURRNET_FILE_DIR, currentFileDir);
        pathStr = pathStr.replace(this.PATH_VARIABLE_CURRNET_FILE_NAME, fileName);
        pathStr = pathStr.replace(this.PATH_VARIABLE_CURRNET_FILE_NAME_WITHOUT_EXT, fileNameWithoutExt);
        return pathStr;
    }
}