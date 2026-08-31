(function () {
    "use strict";

    const PLUGIN_ID = "com.mbgee.aiwriter";
    const COMMAND_ID = "mbgee-ai-writer";

    const STORAGE_KEY = "mbgee-ai-writer-config";

    let page = null;
    let abortController = null;
    let running = false;

    function getConfig() {
        try {
            return JSON.parse(
                localStorage.getItem(STORAGE_KEY)
            ) || {
                provider: "gemini",
                apiKey: ""
            };
        } catch {
            return {
                provider: "gemini",
                apiKey: ""
            };
        }
    }

    function saveConfig(config) {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(config)
        );
    }

    function getEditor() {
        return editorManager.editor;
    }

    function getCurrentCode() {
        const view = getEditor();

        if (!view) {
            return "";
        }

        return view.state.doc.toString();
    }

    function getCursor() {
        const view = getEditor();

        if (!view) {
            return 0;
        }

        return view.state.selection.main.head;
    }

    function insertText(text) {
        const view = getEditor();

        if (!view || !text) {
            return;
        }

        const position = getCursor();

        view.dispatch({
            changes: {
                from: position,
                to: position,
                insert: text
            },
            selection: {
                anchor: position + text.length
            },
            scrollIntoView: true
        });
    }

    function getLanguage() {
        const file =
            editorManager.activeFile;

        if (!file) {
            return "unknown";
        }

        const filename =
            file.name ||
            file.filename ||
            "";

        const extension =
            filename
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

            java: "Java",

            html: "HTML",
            css: "CSS",

            php: "PHP",

            go: "Go",

            rs: "Rust",

            kt: "Kotlin",

            json: "JSON"
        };

        return languages[extension]
            || extension
            || "unknown";
    }

    function buildPrompt(userPrompt) {
        return `
You are MBGee Continue, an AI coding assistant running inside Acode.

Programming language:
${getLanguage()}

CURRENT FILE:
${getCurrentCode()}

USER REQUEST:
${userPrompt}

RULES:

Continue from the user's current cursor.

Return ONLY the code that should be inserted.

Do not use Markdown code fences.

Do not repeat existing code.

Do not rewrite the whole file.

Keep the existing programming style.

If the code is incomplete, continue it correctly.

Write real working code.

No explanation.
`;
    }

    async function streamGemini(
        apiKey,
        prompt,
        onText,
        signal
    ) {
        const model = "gemini-2.5-flash";

        const url =
            "https://generativelanguage.googleapis.com/v1beta/models/" +
            model +
            ":streamGenerateContent?alt=sse&key=" +
            encodeURIComponent(apiKey);

        const response =
            await fetch(url, {
                method: "POST",
                signal,
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify({
                    contents: [
                        {
                            role: "user",
                            parts: [
                                {
                                    text: prompt
                                }
                            ]
                        }
                    ]
                })
            });

        if (!response.ok) {
            throw new Error(
                await response.text()
            );
        }

        await readStream(
            response,
            async data => {
                const parts =
                    data.candidates
                        ?.flatMap(
                            candidate =>
                                candidate.content
                                    ?.parts || []
                        ) || [];

                const text =
                    parts
                        .map(
                            part =>
                                part.text || ""
                        )
                        .join("");

                if (text) {
                    await onText(text);
                }
            }
        );
    }

    async function streamOpenAI(
        apiKey,
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
                            "Bearer " + apiKey
                    },
                    body: JSON.stringify({
                        model: "gpt-5.5",
                        stream: true,
                        instructions:
                            prompt,
                        input:
                            "Continue the code."
                    })
                }
            );

        if (!response.ok) {
            throw new Error(
                await response.text()
            );
        }

        await readStream(
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

    async function streamDeepSeek(
        apiKey,
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
                            "Bearer " + apiKey
                    },
                    body: JSON.stringify({
                        model:
                            "deepseek-chat",

                        stream: true,

                        messages: [
                            {
                                role: "system",
                                content:
                                    prompt
                            },
                            {
                                role: "user",
                                content:
                                    "Continue the code."
                            }
                        ]
                    })
                }
            );

        if (!response.ok) {
            throw new Error(
                await response.text()
            );
        }

        await readStream(
            response,
            async data => {
                const text =
                    data.choices?.[0]
                        ?.delta?.content || "";

                if (text) {
                    await onText(text);
                }
            }
        );
    }

    async function streamClaude(
        apiKey,
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
                            apiKey,

                        "anthropic-version":
                            "2023-06-01"
                    },
                    body: JSON.stringify({
                        model:
                            "claude-sonnet-4-5",

                        max_tokens:
                            12000,

                        stream: true,

                        system:
                            prompt,

                        messages: [
                            {
                                role: "user",
                                content:
                                    "Continue the code."
                            }
                        ]
                    })
                }
            );

        if (!response.ok) {
            throw new Error(
                await response.text()
            );
        }

        await readStream(
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

    async function readStream(
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

                    const value =
                        line
                            .slice(5)
                            .trim();

                    if (
                        !value ||
                        value === "[DONE]"
                    ) {
                        continue;
                    }

                    try {
                        await callback(
                            JSON.parse(value)
                        );
                    } catch {
                    }
                }
            }
        }
    }

    async function humanTyping(
        text,
        status
    ) {
        let buffer = "";

        for (
            let i = 0;
            i < text.length;
            i++
        ) {
            if (!running) {
                break;
            }

            buffer += text[i];

            if (
                buffer.length >= 2 ||
                text[i] === "\n"
            ) {
                insertText(buffer);
                buffer = "";
            }

            if (
                text[i] === "\n"
            ) {
                await sleep(80);
            } else if (
                text[i] === " "
            ) {
                await sleep(4);
            } else {
                await sleep(10);
            }

            status.textContent =
                "MBGee is writing...";
        }

        if (
            buffer &&
            running
        ) {
            insertText(buffer);
        }
    }

    function sleep(ms) {
        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
    }

    async function startWriting() {
        if (running) {
            return;
        }

        const config =
            getConfig();

        if (!config.apiKey) {
            openSettings();
            return;
        }

        if (!getEditor()) {
            alert(
                "Open a code file in Acode first."
            );
            return;
        }

        const promptInput =
            page.querySelector(
                "#mbgee-prompt"
            );

        const status =
            page.querySelector(
                "#mbgee-status"
            );

        const userPrompt =
            promptInput.value.trim()
            || "Continue writing the code.";

        running = true;

        abortController =
            new AbortController();

        status.textContent =
            "Connecting to " +
            config.provider +
            "...";

        try {
            const prompt =
                buildPrompt(
                    userPrompt
                );

            const queue = [];

            let consuming = false;

            const receive =
                async text => {
                    queue.push(text);

                    if (consuming) {
                        return;
                    }

                    consuming = true;

                    while (
                        queue.length &&
                        running
                    ) {
                        const next =
                            queue.shift();

                        await humanTyping(
                            next,
                            status
                        );
                    }

                    consuming = false;
                };

            if (
                config.provider ===
                "gemini"
            ) {
                await streamGemini(
                    config.apiKey,
                    prompt,
                    receive,
                    abortController.signal
                );
            } else if (
                config.provider ===
                "openai"
            ) {
                await streamOpenAI(
                    config.apiKey,
                    prompt,
                    receive,
                    abortController.signal
                );
            } else if (
                config.provider ===
                "deepseek"
            ) {
                await streamDeepSeek(
                    config.apiKey,
                    prompt,
                    receive,
                    abortController.signal
                );
            } else if (
                config.provider ===
                "claude"
            ) {
                await streamClaude(
                    config.apiKey,
                    prompt,
                    receive,
                    abortController.signal
                );
            }

            while (
                queue.length &&
                running
            ) {
                await sleep(20);
            }

            if (running) {
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
                    "Error: " +
                    error.message;
            }
        }

        running = false;
        abortController = null;
    }

    function stopWriting() {
        running = false;

        if (abortController) {
            abortController.abort();
        }

        if (page) {
            const status =
                page.querySelector(
                    "#mbgee-status"
                );

            if (status) {
                status.textContent =
                    "Stopped.";
            }
        }
    }

    function openSettings() {
        const config =
            getConfig();

        page.innerHTML = `
            <div class="mbgee-app">

                <h2>MBGee AI Writer</h2>

                <p class="subtitle">
                    AI configuration
                </p>

                <label>
                    Provider
                </label>

                <select id="mbgee-provider">

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
                    API Key
                </label>

                <input
                    id="mbgee-key"
                    type="password"
                    placeholder="Paste API key here"
                />

                <button
                    id="mbgee-save"
                    class="primary"
                >
                    Save API Key
                </button>

                <button id="mbgee-back">
                    Back
                </button>

                <p class="small">
                    Your API key is stored locally
                    on this device.
                </p>

            </div>
        `;

        page.show();

        page.querySelector(
            "#mbgee-provider"
        ).value =
            config.provider;

        page.querySelector(
            "#mbgee-key"
        ).value =
            config.apiKey;

        page.querySelector(
            "#mbgee-save"
        ).onclick = () => {
            saveConfig({
                provider:
                    page.querySelector(
                        "#mbgee-provider"
                    ).value,

                apiKey:
                    page.querySelector(
                        "#mbgee-key"
                    ).value.trim()
            });

            openWriter();
        };

        page.querySelector(
            "#mbgee-back"
        ).onclick =
            openWriter;
    }

    function openWriter() {
        const config =
            getConfig();

        page.innerHTML = `
            <div class="mbgee-app">

                <div class="mbgee-header">

                    <div>
                        <h2>
                            MBGee Continue
                        </h2>

                        <p>
                            AI coding assistant
                        </p>
                    </div>

                    <button id="mbgee-settings">
                        ⚙
                    </button>

                </div>

                <label>
                    Your instruction
                </label>

                <textarea
                    id="mbgee-prompt"
                    placeholder="Tell MBGee what you want to write..."
                ></textarea>

                <button
                    id="mbgee-continue"
                    class="primary big"
                >
                    Continue Writing
                </button>

                <button
                    id="mbgee-stop"
                >
                    Stop
                </button>

                <div class="buttons">

                    <button id="mbgee-generate">
                        Generate
                    </button>

                    <button id="mbgee-fix">
                        Fix
                    </button>

                    <button id="mbgee-complete">
                        Complete
                    </button>

                </div>

                <div
                    id="mbgee-status"
                    class="status"
                >
                    ${
                        config.apiKey
                        ? "Ready."
                        : "API key required."
                    }
                </div>

                <div class="info">
                    Provider:
                    <b>
                        ${config.provider}
                    </b>
                </div>

                <div class="contributor">
                    Contributor:
                    macdonaldbarasa2026-del
                </div>

            </div>
        `;

        page.show();

        page.querySelector(
            "#mbgee-settings"
        ).onclick =
            openSettings;

        page.querySelector(
            "#mbgee-continue"
        ).onclick =
            startWriting;

        page.querySelector(
            "#mbgee-stop"
        ).onclick =
            stopWriting;

        page.querySelector(
            "#mbgee-generate"
        ).onclick = () => {
            page.querySelector(
                "#mbgee-prompt"
            ).value =
                "Generate the code I describe.";

            startWriting();
        };

        page.querySelector(
            "#mbgee-fix"
        ).onclick = () => {
            page.querySelector(
                "#mbgee-prompt"
            ).value =
                "Fix the current code and continue.";

            startWriting();
        };

        page.querySelector(
            "#mbgee-complete"
        ).onclick = () => {
            page.querySelector(
                "#mbgee-prompt"
            ).value =
                "Complete the current code from the cursor.";

            startWriting();
        };
    }

    function addStyles() {
        const style =
            document.createElement(
                "style"
            );

        style.textContent = `
            .mbgee-app {
                padding: 16px;
                font-family: sans-serif;
            }

            .mbgee-app h2 {
                margin: 0 0 4px;
            }

            .subtitle {
                opacity: .7;
                margin-top: 0;
            }

            .mbgee-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .mbgee-app label {
                display: block;
                margin-top: 16px;
                margin-bottom: 6px;
            }

            .mbgee-app input,
            .mbgee-app textarea,
            .mbgee-app select {
                width: 100%;
                box-sizing: border-box;
                padding: 12px;
                border-radius: 8px;
                border: 1px solid #777;
                background: transparent;
                color: inherit;
                font-size: 15px;
            }

            .mbgee-app textarea {
                min-height: 110px;
                resize: vertical;
            }

            .mbgee-app button {
                padding: 11px 14px;
                margin-top: 10px;
                border-radius: 8px;
                border: 1px solid #777;
                background: transparent;
                color: inherit;
                font-size: 14px;
            }

            .mbgee-app button.primary {
                width: 100%;
                border: 0;
                font-weight: bold;
            }

            .mbgee-app button.big {
                padding: 15px;
                font-size: 16px;
            }

            .mbgee-app .buttons {
                display: flex;
                gap: 7px;
            }

            .mbgee-app .buttons button {
                flex: 1;
            }

            .status {
                margin-top: 16px;
                padding: 10px;
                border-radius: 8px;
                background: rgba(128,128,128,.15);
            }

            .info {
                margin-top: 12px;
                opacity: .8;
            }

            .contributor {
                margin-top: 20px;
                font-size: 12px;
                opacity: .6;
                text-align: center;
            }

            .small {
                font-size: 12px;
                opacity: .6;
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
            name: COMMAND_ID,
            description:
                "Open MBGee AI Writer",
            exec: openWriter
        });
    }

    function unmount() {
        stopWriting();

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
