(function () {
    "use strict";

    const PLUGIN_ID = "com.mbgee.aiwriter";
    const COMMAND_ID = "mbgee-ai-writer";
    const STORAGE_KEY = "mbgee-ai-writer-v3";

    let page;
    let abortController = null;
    let isRunning = false;

    const DEFAULTS = {
        provider: "gemini",
        keys: {
            gemini: "",
            openai: "",
            claude: "",
            deepseek: ""
        }
    };

    function loadSettings() {
        try {
            const saved = JSON.parse(
                localStorage.getItem(STORAGE_KEY)
            );

            return {
                provider:
                    saved?.provider ||
                    DEFAULTS.provider,

                keys: {
                    ...DEFAULTS.keys,
                    ...(saved?.keys || {})
                }
            };
        } catch {
            return JSON.parse(
                JSON.stringify(DEFAULTS)
            );
        }
    }

    function saveSettings(settings) {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(settings)
        );
    }

    function getEditor() {
        return editorManager.editor;
    }

    function getFileName() {
        const file =
            editorManager.activeFile;

        return (
            file?.name ||
            file?.filename ||
            "untitled"
        );
    }

    function getLanguage() {
        const name =
            getFileName();

        const ext =
            name
                .split(".")
                .pop()
                .toLowerCase();

        const languages = {
            cpp: "C++",
            cc: "C++",
            cxx: "C++",
            hpp: "C++",
            c: "C",

            py: "Python",

            js: "JavaScript",
            jsx: "JavaScript",

            ts: "TypeScript",
            tsx: "TypeScript",

            html: "HTML",
            css: "CSS",

            java: "Java",

            kt: "Kotlin",

            go: "Go",

            rs: "Rust",

            php: "PHP",

            json: "JSON"
        };

        return (
            languages[ext] ||
            ext ||
            "text"
        );
    }

    function getCode() {
        const view =
            getEditor();

        if (!view) {
            return "";
        }

        return view.state.doc.toString();
    }

    function getSelection() {
        const view =
            getEditor();

        if (!view) {
            return "";
        }

        const selection =
            view.state.selection.main;

        return view.state.doc.sliceString(
            selection.from,
            selection.to
        );
    }

    function getCursor() {
        const view =
            getEditor();

        if (!view) {
            return 0;
        }

        return view.state.selection.main.head;
    }

    function insertAtCursor(text) {
        const view =
            getEditor();

        if (!view || !text) {
            return;
        }

        const position =
            getCursor();

        view.dispatch({
            changes: {
                from: position,
                to: position,
                insert: text
            },

            selection: {
                anchor:
                    position + text.length
            },

            scrollIntoView: true
        });
    }

    function replaceSelection(text) {
        const view =
            getEditor();

        if (!view) {
            return;
        }

        const selection =
            view.state.selection.main;

        view.dispatch({
            changes: {
                from: selection.from,
                to: selection.to,
                insert: text
            },

            selection: {
                anchor:
                    selection.from +
                    text.length
            }
        });
    }

    function buildSystemPrompt() {
        return `
You are MBGee AI, an AI coding assistant
inside the Acode mobile code editor.

Current file:
${getFileName()}

Programming language:
${getLanguage()}

You can help with:
- writing code
- completing code
- fixing code
- explaining code
- refactoring
- debugging
- improving code
- continuing from the cursor

When the user asks for code to be inserted,
return only the code.

Do not use Markdown fences when returning
code intended for the editor.

Respect the existing code.

Do not unnecessarily rewrite the entire file.
`;
    }

    function buildContinuePrompt(instruction) {
        return `
${buildSystemPrompt()}

CURRENT FILE:

${getCode()}

USER INSTRUCTION:

${instruction || "Continue writing from the cursor."}

IMPORTANT:

Continue from the current cursor position.

Return ONLY the new code that should be
inserted at the cursor.

Do not repeat code that already exists.
Do not explain anything.
`;
    }

    function buildChatPrompt(message) {
        return `
${buildSystemPrompt()}

CURRENT FILE:

${getCode()}

SELECTED CODE:

${getSelection() || "(nothing selected)"}

USER:

${message}
`;
    }

    async function readSSE(
        response,
        callback
    ) {
        const reader =
            response.body.getReader();

        const decoder =
            new TextDecoder();

        let buffer = "";

        while (true) {
            const result =
                await reader.read();

            if (result.done) {
                break;
            }

            buffer += decoder.decode(
                result.value,
                {
                    stream: true
                }
            );

            const events =
                buffer.split("\n\n");

            buffer =
                events.pop() || "";

            for (
                const event of events
            ) {
                const lines =
                    event.split("\n");

                for (
                    const line of lines
                ) {
                    if (
                        !line.startsWith(
                            "data:"
                        )
                    ) {
                        continue;
                    }

                    const raw =
                        line
                            .slice(5)
                            .trim();

                    if (
                        !raw ||
                        raw === "[DONE]"
                    ) {
                        continue;
                    }

                    try {
                        await callback(
                            JSON.parse(raw)
                        );
                    } catch {
                        // Ignore incomplete SSE data.
                    }
                }
            }
        }
    }

    async function askGemini(
        key,
        prompt,
        onText,
        signal
    ) {
        const url =
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=" +
            encodeURIComponent(key);

        const response =
            await fetch(url, {
                method: "POST",

                signal,

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    systemInstruction: {
                        parts: [
                            {
                                text:
                                    buildSystemPrompt()
                            }
                        ]
                    },

                    contents: [
                        {
                            role: "user",

                            parts: [
                                {
                                    text:
                                        prompt
                                }
                            ]
                        }
                    ]
                })
            });

        if (!response.ok) {
            throw new Error(
                "Gemini: " +
                await response.text()
            );
        }

        await readSSE(
            response,
            async data => {
                const text =
                    data.candidates
                        ?.flatMap(
                            c =>
                                c.content
                                    ?.parts ||
                                []
                        )
                        ?.map(
                            p =>
                                p.text || ""
                        )
                        ?.join("") || "";

                if (text) {
                    await onText(text);
                }
            }
        );
    }

    async function askOpenAI(
        key,
        prompt,
        onText,
        signal
    ) {
        const response =
            await fetch(
                "https://api.openai.com/v1/responses",
                {
                    method: "POST",

                    signal,

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Authorization":
                            "Bearer " + key
                    },

                    body: JSON.stringify({
                        model: "gpt-5.5",

                        stream: true,

                        instructions:
                            buildSystemPrompt(),

                        input: prompt
                    })
                }
            );

        if (!response.ok) {
            throw new Error(
                "OpenAI: " +
                await response.text()
            );
        }

        await readSSE(
            response,
            async data => {
                if (
                    data.type ===
                    "response.output_text.delta"
                ) {
                    if (data.delta) {
                        await onText(
                            data.delta
                        );
                    }
                }
            }
        );
    }

    async function askDeepSeek(
        key,
        prompt,
        onText,
        signal
    ) {
        const response =
            await fetch(
                "https://api.deepseek.com/chat/completions",
                {
                    method: "POST",

                    signal,

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Authorization":
                            "Bearer " + key
                    },

                    body: JSON.stringify({
                        model:
                            "deepseek-chat",

                        stream: true,

                        messages: [
                            {
                                role:
                                    "system",

                                content:
                                    buildSystemPrompt()
                            },

                            {
                                role:
                                    "user",

                                content:
                                    prompt
                            }
                        ]
                    })
                }
            );

        if (!response.ok) {
            throw new Error(
                "DeepSeek: " +
                await response.text()
            );
        }

        await readSSE(
            response,
            async data => {
                const text =
                    data.choices?.[0]
                        ?.delta?.content ||
                    "";

                if (text) {
                    await onText(text);
                }
            }
        );
    }

    async function askClaude(
        key,
        prompt,
        onText,
        signal
    ) {
        const response =
            await fetch(
                "https://api.anthropic.com/v1/messages",
                {
                    method: "POST",

                    signal,

                    headers: {
                        "Content-Type":
                            "application/json",

                        "x-api-key":
                            key,

                        "anthropic-version":
                            "2023-06-01"
                    },

                    body: JSON.stringify({
                        model:
                            "claude-sonnet-4-5",

                        max_tokens:
                            16000,

                        stream: true,

                        system:
                            buildSystemPrompt(),

                        messages: [
                            {
                                role:
                                    "user",

                                content:
                                    prompt
                            }
                        ]
                    })
                }
            );

        if (!response.ok) {
            throw new Error(
                "Claude: " +
                await response.text()
            );
        }

        await readSSE(
            response,
            async data => {
                if (
                    data.type ===
                    "content_block_delta"
                ) {
                    const text =
                        data.delta?.text ||
                        "";

                    if (text) {
                        await onText(text);
                    }
                }
            }
        );
    }

    async function requestAI(
        prompt,
        onText
    ) {
        const config =
            loadSettings();

        const key =
            config.keys[
                config.provider
            ];

        if (!key) {
            throw new Error(
                "No API key configured for " +
                config.provider
            );
        }

        abortController =
            new AbortController();

        if (
            config.provider ===
            "gemini"
        ) {
            return askGemini(
                key,
                prompt,
                onText,
                abortController.signal
            );
        }

        if (
            config.provider ===
            "openai"
        ) {
            return askOpenAI(
                key,
                prompt,
                onText,
                abortController.signal
            );
        }

        if (
            config.provider ===
            "deepseek"
        ) {
            return askDeepSeek(
                key,
                prompt,
                onText,
                abortController.signal
            );
        }

        if (
            config.provider ===
            "claude"
        ) {
            return askClaude(
                key,
                prompt,
                onText,
                abortController.signal
            );
        }
    }

    async function humanWrite(
        text,
        status
    ) {
        let buffer = "";

        for (
            let i = 0;
            i < text.length;
            i++
        ) {
            if (!isRunning) {
                break;
            }

            buffer += text[i];

            if (
                buffer.length >= 2 ||
                text[i] === "\n"
            ) {
                insertAtCursor(
                    buffer
                );

                buffer = "";
            }

            if (
                text[i] === "\n"
            ) {
                await wait(70);
            } else if (
                text[i] === " "
            ) {
                await wait(3);
            } else {
                await wait(9);
            }

            status.textContent =
                "MBGee is writing...";
        }

        if (
            buffer &&
            isRunning
        ) {
            insertAtCursor(
                buffer
            );
        }
    }

    function wait(ms) {
        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
    }

    async function continueCode() {
        if (isRunning) {
            return;
        }

        const config =
            loadSettings();

        if (
            !config.keys[
                config.provider
            ]
        ) {
            openSettings();
            return;
        }

        const instruction =
            page.querySelector(
                "#mbgee-prompt"
            ).value.trim();

        const status =
            page.querySelector(
                "#mbgee-status"
            );

        isRunning = true;

        status.textContent =
            "Connecting to " +
            config.provider +
            "...";

        try {
            await requestAI(
                buildContinuePrompt(
                    instruction
                ),
                async text => {
                    await humanWrite(
                        text,
                        status
                    );
                }
            );

            if (isRunning) {
                status.textContent =
                    "✓ Finished.";
            }

        } catch (error) {

            if (
                error.name ===
                "AbortError"
            ) {
                status.textContent =
                    "Stopped.";
            } else {
                status.textContent =
                    error.message;
            }

        } finally {
            isRunning = false;
            abortController = null;
        }
    }

    function stop() {
        isRunning = false;

        if (abortController) {
            abortController.abort();
        }

        const status =
            page?.querySelector(
                "#mbgee-status"
            );

        if (status) {
            status.textContent =
                "Stopped.";
        }
    }

    async function chat() {
        const input =
            page.querySelector(
                "#mbgee-chat"
            );

        const output =
            page.querySelector(
                "#mbgee-chat-output"
            );

        const message =
            input.value.trim();

        if (!message) {
            return;
        }

        const config =
            loadSettings();

        if (
            !config.keys[
                config.provider
            ]
        ) {
            openSettings();
            return;
        }

        input.value = "";

        output.innerHTML +=
            `<div class="user-msg">
                <b>You:</b>
                ${escapeHTML(message)}
            </div>`;

        output.innerHTML +=
            `<div class="ai-msg" id="live-ai">
                <b>MBGee:</b>
                <span></span>
            </div>`;

        const live =
            output.querySelector(
                "#live-ai span"
            );

        try {
            await requestAI(
                buildChatPrompt(
                    message
                ),
                async text => {
                    live.textContent +=
                        text;

                    output.scrollTop =
                        output.scrollHeight;
                }
            );
        } catch (error) {
            live.textContent =
                error.message;
        }
    }

    function escapeHTML(text) {
        return text
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }

    function openSettings() {
        const config =
            loadSettings();

        page.innerHTML = `
            <div class="mbgee">

                <div class="header">
                    <div>
                        <h2>MBGee AI</h2>
                        <small>Settings</small>
                    </div>

                    <button id="back">
                        Back
                    </button>
                </div>

                <label>Default AI</label>

                <select id="provider">

                    <option value="gemini">
                        Gemini
                    </option>

                    <option value="openai">
                        OpenAI
                    </option>

                    <option value="claude">
                        Claude
                    </option>

                    <option value="deepseek">
                        DeepSeek
                    </option>

                </select>

                <label>
                    Gemini API Key
                </label>

                <input
                    id="gemini"
                    type="password"
                    placeholder="Gemini API key"
                />

                <label>
                    OpenAI API Key
                </label>

                <input
                    id="openai"
                    type="password"
                    placeholder="OpenAI API key"
                />

                <label>
                    Claude API Key
                </label>

                <input
                    id="claude"
                    type="password"
                    placeholder="Claude API key"
                />

                <label>
                    DeepSeek API Key
                </label>

                <input
                    id="deepseek"
                    type="password"
                    placeholder="DeepSeek API key"
                />

                <button
                    id="save"
                    class="primary"
                >
                    Save Settings
                </button>

                <p class="privacy">
                    API keys stay on this device
                    in the plugin's local storage.
                </p>

            </div>
        `;

        page.show();

        page.querySelector(
            "#provider"
        ).value =
            config.provider;

        page.querySelector(
            "#gemini"
        ).value =
            config.keys.gemini;

        page.querySelector(
            "#openai"
        ).value =
            config.keys.openai;

        page.querySelector(
            "#claude"
        ).value =
            config.keys.claude;

        page.querySelector(
            "#deepseek"
        ).value =
            config.keys.deepseek;

        page.querySelector(
            "#save"
        ).onclick = () => {

            saveSettings({
                provider:
                    page.querySelector(
                        "#provider"
                    ).value,

                keys: {
                    gemini:
                        page.querySelector(
                            "#gemini"
                        ).value.trim(),

                    openai:
                        page.querySelector(
                            "#openai"
                        ).value.trim(),

                    claude:
                        page.querySelector(
                            "#claude"
                        ).value.trim(),

                    deepseek:
                        page.querySelector(
                            "#deepseek"
                        ).value.trim()
                }
            });

            openWriter();
        };

        page.querySelector(
            "#back"
        ).onclick =
            openWriter;
    }

    function openWriter() {
        const config =
            loadSettings();

        page.innerHTML = `
            <div class="mbgee">

                <div class="header">

                    <div>
                        <h2>
                            MBGee AI
                        </h2>

                        <small>
                            ${getLanguage()}
                        </small>
                    </div>

                    <button
                        id="settings"
                    >
                        ⚙
                    </button>

                </div>

                <div class="tabs">

                    <button
                        id="tab-chat"
                        class="active"
                    >
                        Chat
                    </button>

                    <button
                        id="tab-code"
                    >
                        Code
                    </button>

                </div>

                <div
                    id="chat-view"
                >

                    <div
                        id="mbgee-chat-output"
                        class="chat"
                    >
                        <div class="ai-msg">
                            <b>MBGee:</b>
                            Ready. Ask me about
                            your code.
                        </div>
                    </div>

                    <textarea
                        id="mbgee-chat"
                        placeholder="Ask MBGee anything about your code..."
                    ></textarea>

                    <button
                        id="send"
                        class="primary"
                    >
                        Send to AI
                    </button>

                </div>

                <div
                    id="code-view"
                    class="hidden"
                >

                    <textarea
                        id="mbgee-prompt"
                        placeholder="Tell MBGee what to write..."
                    ></textarea>

                    <button
                        id="continue"
                        class="primary big"
                    >
                        Continue Writing
                    </button>

                    <button
                        id="stop"
                    >
                        Stop
                    </button>

                    <div class="actions">

                        <button
                            id="generate"
                        >
                            Generate
                        </button>

                        <button
                            id="fix"
                        >
                            Fix
                        </button>

                        <button
                            id="complete"
                        >
                            Complete
                        </button>

                    </div>

                    <div
                        id="mbgee-status"
                        class="status"
                    >
                        Ready.
                    </div>

                </div>

                <div class="footer">

                    Provider:
                    <b>
                        ${config.provider}
                    </b>

                    <br>

                    Contributor:
                    macdonaldbarasa2026-del

                </div>

            </div>
        `;

        page.show();

        page.querySelector(
            "#settings"
        ).onclick =
            openSettings;

        page.querySelector(
            "#send"
        ).onclick =
            chat;

        page.querySelector(
            "#continue"
        ).onclick =
            continueCode;

        page.querySelector(
            "#stop"
        ).onclick =
            stop;

        page.querySelector(
            "#generate"
        ).onclick = () => {

            page.querySelector(
                "#mbgee-prompt"
            ).value =
                "Generate the code requested by the user.";

            continueCode();
        };

        page.querySelector(
            "#fix"
        ).onclick = () => {

            page.querySelector(
                "#mbgee-prompt"
            ).value =
                "Fix the current code.";

            continueCode();
        };

        page.querySelector(
            "#complete"
        ).onclick = () => {

            page.querySelector(
                "#mbgee-prompt"
            ).value =
                "Complete the current code.";

            continueCode();
        };

        const chatTab =
            page.querySelector(
                "#tab-chat"
            );

        const codeTab =
            page.querySelector(
                "#tab-code"
            );

        const chatView =
            page.querySelector(
                "#chat-view"
            );

        const codeView =
            page.querySelector(
                "#code-view"
            );

        chatTab.onclick = () => {

            chatTab.classList.add(
                "active"
            );

            codeTab.classList.remove(
                "active"
            );

            chatView.classList.remove(
                "hidden"
            );

            codeView.classList.add(
                "hidden"
            );
        };

        codeTab.onclick = () => {

            codeTab.classList.add(
                "active"
            );

            chatTab.classList.remove(
                "active"
            );

            codeView.classList.remove(
                "hidden"
            );

            chatView.classList.add(
                "hidden"
            );
        };
    }

    function addStyles() {
        const style =
            document.createElement(
                "style"
            );

        style.textContent = `
            .mbgee {
                padding: 14px;
                font-family: sans-serif;
            }

            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
            }

            .header h2 {
                margin: 0;
            }

            .header small {
                opacity: .65;
            }

            .tabs {
                display: flex;
                gap: 6px;
                margin-bottom: 12px;
            }

            .tabs button {
                flex: 1;
            }

            .mbgee label {
                display: block;
                margin-top: 12px;
                margin-bottom: 5px;
            }

            .mbgee input,
            .mbgee select,
            .mbgee textarea {
                width: 100%;
                box-sizing: border-box;
                padding: 11px;
                border-radius: 8px;
                border: 1px solid #777;
                background: transparent;
                color: inherit;
                font-size: 14px;
            }

            .mbgee textarea {
                min-height: 95px;
                resize: vertical;
            }

            .mbgee button {
                border: 1px solid #777;
                background: transparent;
                color: inherit;
                padding: 10px 12px;
                border-radius: 8px;
                margin-top: 8px;
            }

            .mbgee button.primary {
                width: 100%;
                font-weight: bold;
            }

            .mbgee button.big {
                padding: 14px;
                font-size: 15px;
            }

            .actions {
                display: flex;
                gap: 6px;
            }

            .actions button {
                flex: 1;
            }

            .chat {
                min-height: 240px;
                max-height: 48vh;
                overflow-y: auto;
                padding: 8px;
                border: 1px solid #555;
                border-radius: 8px;
                margin-bottom: 8px;
            }

            .user-msg,
            .ai-msg {
                margin-bottom: 12px;
                line-height: 1.45;
            }

            .user-msg {
                opacity: .85;
            }

            .ai-msg {
                white-space: pre-wrap;
            }

            .status {
                margin-top: 12px;
                padding: 10px;
                border-radius: 8px;
                background: rgba(128,128,128,.15);
            }

            .footer {
                margin-top: 18px;
                text-align: center;
                font-size: 11px;
                opacity: .6;
            }

            .privacy {
                font-size: 11px;
                opacity: .6;
            }

            .hidden {
                display: none;
            }

            .tabs .active {
                font-weight: bold;
            }
        `;

        document.head.appendChild(
            style
        );
    }

    function init(
        baseUrl,
        $page,
        cache
    ) {
        page = $page;

        addStyles();

        openWriter();

        const commands =
            acode.require(
                "commands"
            );

        commands.addCommand({
            name:
                COMMAND_ID,

            description:
                "Open MBGee AI",

            exec:
                openWriter
        });
    }

    function unmount() {
        stop();

        const commands =
            acode.require(
                "commands"
            );

        commands.removeCommand(
            COMMAND_ID
        );
    }

    acode.setPluginInit(
        PLUGIN_ID,
        init
    );

    acode.setPluginUnmount(
        PLUGIN_ID,
        unmount
    );

})();
