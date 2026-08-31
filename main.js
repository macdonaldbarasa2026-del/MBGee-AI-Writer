(function () {

    "use strict";

    const pluginId = "com.mbgee.aiwriter";
    const commandName = "mbgee-ai-writer";

    const STORAGE_KEY = "mbgee-ai-writer-settings";

    let page = null;
    let controller = null;
    let writing = false;

    function settings() {

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

    function saveSettings(data) {

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(data)
        );
    }

    function editor() {
        return editorManager.editor;
    }

    function code() {

        const view = editor();

        if (!view) return "";

        return view.state.doc.toString();
    }

    function cursorPosition() {

        const view = editor();

        if (!view) return 0;

        return view.state.selection.main.head;
    }

    function insertAtCursor(text) {

        const view = editor();

        if (!view) return;

        const position =
            cursorPosition();

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

    function language() {

        const file =
            editorManager.activeFile;

        if (!file) return "unknown";

        const name =
            file.name ||
            file.filename ||
            "";

        const ext =
            name
                .split(".")
                .pop()
                .toLowerCase();

        const map = {

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

            json: "JSON",

            php: "PHP",

            go: "Go",

            rs: "Rust",

            kt: "Kotlin"
        };

        return map[ext] || ext || "unknown";
    }

    function promptForContinue() {

        return `
You are MBGee Continue, an AI coding assistant inside Acode.

Continue writing the code from the user's current cursor.

Programming language:
${language()}

Rules:

1. Continue from the cursor.
2. Do not rewrite the existing code.
3. Do not repeat code that already exists.
4. Return ONLY the code that should be inserted.
5. Do not use Markdown fences.
6. Match the existing coding style.
7. Finish incomplete statements when appropriate.
8. Add useful imports only when required.
9. Do not explain the code.
10. Write production-quality code.

CURRENT FILE:

${code()}

The cursor is at the insertion point.

Generate only the next code.
`;
    }

    async function streamGemini(
        apiKey,
        onChunk,
        signal
    ) {

        const model =
            "gemini-2.5-flash";

        const url =
            "https://generativelanguage.googleapis.com/v1beta/models/" +
            model +
            ":streamGenerateContent?alt=sse&key=" +
            encodeURIComponent(apiKey);

        const response =
            await fetch(
                url,
                {
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
                                        text:
                                            promptForContinue()
                                    }

                                ]
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

        await readSSE(
            response,
            async data => {

                const text =
                    data.candidates
                        ?.map(
                            c =>
                                c.content
                                    ?.parts
                                    ?.map(
                                        p =>
                                            p.text || ""
                                    )
                                    .join("")
                        )
                        .join("") || "";

                if (text) {
                    await onChunk(text);
                }
            }
        );
    }

    async function streamOpenAI(
        apiKey,
        onChunk,
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
                            "Bearer " +
                            apiKey
                    },

                    body: JSON.stringify({

                        model:
                            "gpt-5.5",

                        stream: true,

                        instructions:
                            promptForContinue(),

                        input:
                            "Continue the code from the current cursor."
                    })
                }
            );

        if (!response.ok) {

            throw new Error(
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
                        await onChunk(
                            data.delta
                        );
                    }
                }
            }
        );
    }

    async function streamDeepSeek(
        apiKey,
        onChunk,
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
                            "Bearer " +
                            apiKey
                    },

                    body: JSON.stringify({

                        model:
                            "deepseek-chat",

                        stream: true,

                        messages: [

                            {
                                role: "system",

                                content:
                                    promptForContinue()
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

        await readSSE(
            response,
            async data => {

                const text =
                    data.choices
                        ?.map(
                            c =>
                                c.delta
                                    ?.content || ""
                        )
                        .join("") || "";

                if (text) {
                    await onChunk(text);
                }
            }
        );
    }

    async function streamClaude(
        apiKey,
        onChunk,
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
                            promptForContinue(),

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

        await readSSE(
            response,
            async data => {

                if (
                    data.type ===
                    "content_block_delta"
                ) {

                    if (
                        data.delta &&
                        data.delta.text
                    ) {

                        await onChunk(
                            data.delta.text
                        );
                    }
                }
            }
        );
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

            if (result.done) break;

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

                        const data =
                            JSON.parse(
                                raw
                            );

                        await callback(
                            data
                        );

                    } catch {

                        /*
                            Ignore malformed or
                            incomplete SSE packets.
                        */
                    }
                }
            }
        }
    }

    async function writeHuman(
        text,
        status
    ) {

        let buffer = "";

        for (
            let i = 0;
            i < text.length;
            i++
        ) {

            if (!writing) {
                break;
            }

            buffer += text[i];

            /*
                Insert small chunks rather
                than resetting the document.
            */

            if (
                buffer.length >= 2 ||
                text[i] === "\n"
            ) {

                insertAtCursor(
                    buffer
                );

                buffer = "";

                status.textContent =
                    "Writing...";
            }

            let delay = 10;

            if (
                text[i] === "\n"
            ) {
                delay = 80;
            }

            if (
                text[i] === " "
            ) {
                delay = 4;
            }

            await sleep(delay);
        }

        if (
            buffer &&
            writing
        ) {

            insertAtCursor(
                buffer
            );
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

    async function continueWriting() {

        if (writing) return;

        const cfg =
            settings();

        if (!cfg.apiKey) {

            openSettings();

            return;
        }

        if (!editor()) {

            alert(
                "Open a code file first."
            );

            return;
        }

        writing = true;

        controller =
            new AbortController();

        const status =
            page.querySelector(
                "#status"
            );

        status.textContent =
            "AI is thinking...";

        try {

            const writeQueue = [];

            let activeWriter = false;

            const consume =
                async text => {

                    writeQueue.push(
                        text
                    );

                    if (
                        activeWriter
                    ) {
                        return;
                    }

                    activeWriter = true;

                    while (
                        writeQueue.length &&
                        writing
                    ) {

                        const next =
                            writeQueue.shift();

                        await writeHuman(
                            next,
                            status
                        );
                    }

                    activeWriter = false;
                };

            if (
                cfg.provider ===
                "gemini"
            ) {

                await streamGemini(
                    cfg.apiKey,
                    consume,
                    controller.signal
                );

            } else if (
                cfg.provider ===
                "openai"
            ) {

                await streamOpenAI(
                    cfg.apiKey,
                    consume,
                    controller.signal
                );

            } else if (
                cfg.provider ===
                "deepseek"
            ) {

                await streamDeepSeek(
                    cfg.apiKey,
                    consume,
                    controller.signal
                );

            } else if (
                cfg.provider ===
                "claude"
            ) {

                await streamClaude(
                    cfg.apiKey,
                    consume,
                    controller.signal
                );

            } else {

                throw new Error(
                    "Unknown provider."
                );
            }

            while (
                writeQueue.length &&
                writing
            ) {

                await sleep(20);
            }

            if (writing) {

                status.textContent =
                    "✓ Continue finished.";
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

        } finally {

            writing = false;
            controller = null;
        }
    }

    function stopWriting() {

        writing = false;

        if (controller) {
            controller.abort();
        }

        if (page) {

            const status =
                page.querySelector(
                    "#status"
                );

            if (status) {
                status.textContent =
                    "Stopped.";
            }
        }
    }

    function openSettings() {

        const cfg =
            settings();

        page.innerHTML = `

            <div class="mbgee-panel">

                <h2>MBGee AI Writer</h2>

                <p>
                    AI provider
                </p>

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

                <p>
                    API key
                </p>

                <input
                    id="apiKey"
                    type="password"
                    placeholder="Paste API key"
                />

                <button
                    id="save"
                    class="primary"
                >
                    Save
                </button>

                <button id="back">
                    Back
                </button>

            </div>
        `;

        page.show();

        page.querySelector(
            "#provider"
        ).value =
            cfg.provider;

        page.querySelector(
            "#apiKey"
        ).value =
            cfg.apiKey;

        page.querySelector(
            "#save"
        ).onclick = () => {

            saveSettings({

                provider:
                    page.querySelector(
                        "#provider"
                    ).value,

                apiKey:
                    page.querySelector(
                        "#apiKey"
                    ).value.trim()
            });

            openWriter();
        };

        page.querySelector(
            "#back"
        ).onclick =
            openWriter;
    }

    function openWriter() {

        const cfg =
            settings();

        page.innerHTML = `

            <div class="mbgee-panel">

                <div class="top">

                    <div>

                        <strong>
                            MBGee Continue
                        </strong>

                        <small>
                            Human-time AI coding
                        </small>

                    </div>

                    <button id="settings">
                        ⚙
                    </button>

                </div>

                <button
                    id="continue"
                    class="continue"
                >
                    Continue Writing
                </button>

                <button
                    id="stop"
                    class="stop"
                >
                    Stop
                </button>

                <textarea
                    id="prompt"
                    placeholder="Optional instruction..."
                ></textarea>

                <div class="actions">

                    <button id="generate">
                        Generate
                    </button>

                    <button id="fix">
                        Fix
                    </button>

                    <button id="complete">
                        Complete
                    </button>

                </div>

                <div
                    id="status"
                    class="status"
                >
                    ${
                        cfg.apiKey
                        ? "Ready."
                        : "API key required."
                    }
                </div>

                <div class="provider">

                    Provider:
                    <b>
                        ${cfg.provider}
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
            "#settings"
        ).onclick =
            openSettings;

        page.querySelector(
            "#continue"
        ).onclick =
            async () => {

                const extra =
                    page.querySelector(
                        "#prompt"
                    ).value.trim();

                if (extra) {

                    /*
                        Add the instruction to the
                        Continue prompt by temporarily
                        modifying the current request.
                    */

                    window.mbgeeExtra =
                        extra;
                }

                await continueWriting();
            };

        page.querySelector(
            "#stop"
        ).onclick =
            stopWriting;

        page.querySelector(
            "#generate"
        ).onclick =
            () => {

                page.querySelector(
                    "#prompt"
                ).value =
                    "Generate the requested code.";

                continueWriting();
            };

        page.querySelector(
            "#fix"
        ).onclick =
            () => {

                page.querySelector(
                    "#prompt"
                ).value =
                    "Fix the current code and continue from the cursor.";

                continueWriting();
            };

        page.querySelector(
            "#complete"
        ).onclick =
            () => {

                page.querySelector(
                    "#prompt"
                ).value =
                    "Complete the current code from the cursor.";

                continueWriting();
            };
    }

    function init(
        baseUrl,
        $page,
        cache
    ) {

        page = $page;

        const commands =
            acode.require(
                "commands"
            );

        commands.addCommand({

            name:
                commandName,

            description:
                "Open MBGee Continue",

            exec:
                openWriter
        });
    }

    function unmount() {

        stopWriting();

        const commands =
            acode.require(
                "commands"
            );

        commands.removeCommand(
            commandName
        );
    }

    acode.setPluginInit(
        pluginId,
        init
    );

    acode.setPluginUnmount(
        pluginId,
        unmount
    );

})();
