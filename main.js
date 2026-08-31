(function () {

    "use strict";

    const pluginId =
        "com.mbgee.aiwriter";

    const commandName =
        "mbgee-ai-writer";

    let page = null;

    const STORAGE_KEY =
        "mbgee-ai-writer-settings";

    function loadSettings() {

        try {

            const saved =
                localStorage.getItem(
                    STORAGE_KEY
                );

            return saved
                ? JSON.parse(saved)
                : {
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

    function saveSettings(settings) {

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(settings)
        );
    }

    function getEditor() {

        return editorManager.editor;
    }

    function getCode() {

        const editor =
            getEditor();

        if (!editor) {
            return "";
        }

        return editor.getValue();
    }

    function setCode(text) {

        const editor =
            getEditor();

        if (!editor) {
            return;
        }

        editor.setValue(text);
    }

    function getLanguage() {

        const file =
            editorManager.activeFile;

        if (!file) {
            return "unknown";
        }

        const name =
            file.name || "";

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
            h: "C",

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

        return languages[ext]
            || ext
            || "unknown";
    }

    function cleanCode(text) {

        return text
            .replace(
                /^```[a-zA-Z0-9_+-]*\s*/,
                ""
            )
            .replace(
                /\s*```$/,
                ""
            );
    }

    async function askGemini(
        apiKey,
        prompt,
        code,
        language
    ) {

        const model =
            "gemini-2.5-flash";

        const url =
            "https://generativelanguage.googleapis.com/v1beta/models/" +
            model +
            ":generateContent?key=" +
            encodeURIComponent(apiKey);

        const response =
            await fetch(
                url,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        systemInstruction: {
                            parts: [{
                                text: `
You are MBGee AI Writer.

You are a coding assistant inside Acode.

Language:
${language}

Return real working code.

The user wants code that can be inserted
directly into the current editor.

Do not use Markdown fences.

Do not add unnecessary explanations.

Preserve useful existing functionality.

When asked to modify code, return the
complete updated code.
`
                            }]
                        },

                        contents: [{
                            role: "user",

                            parts: [{
                                text: `
CURRENT CODE:

${code}

USER REQUEST:

${prompt}
`
                            }]
                        }]
                    })
                }
            );

        if (!response.ok) {

            const error =
                await response.text();

            throw new Error(
                "Gemini: " + error
            );
        }

        const data =
            await response.json();

        return data
            .candidates?.[0]
            ?.content?.parts
            ?.map(
                p => p.text || ""
            )
            .join("")
            || "";
    }

    async function askOpenAI(
        apiKey,
        prompt,
        code,
        language
    ) {

        const response =
            await fetch(
                "https://api.openai.com/v1/responses",
                {
                    method: "POST",

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

                        instructions: `
You are MBGee AI Writer.

You are an AI coding assistant inside Acode.

Language:
${language}

Return only usable code.

Do not use Markdown code fences.

Preserve existing functionality.

When modifying code, return the
complete updated file.
`,

                        input: `
CURRENT CODE:

${code}

USER REQUEST:

${prompt}
`
                    })
                }
            );

        if (!response.ok) {

            const error =
                await response.text();

            throw new Error(
                "OpenAI: " + error
            );
        }

        const data =
            await response.json();

        return data.output_text || "";
    }

    async function askDeepSeek(
        apiKey,
        prompt,
        code,
        language
    ) {

        const response =
            await fetch(
                "https://api.deepseek.com/chat/completions",
                {
                    method: "POST",

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

                        messages: [

                            {
                                role: "system",

                                content: `
You are MBGee AI Writer.

Programming language:
${language}

Return only usable code.

Do not use Markdown fences.
`
                            },

                            {
                                role: "user",

                                content: `
CURRENT CODE:

${code}

REQUEST:

${prompt}
`
                            }
                        ]
                    })
                }
            );

        if (!response.ok) {

            const error =
                await response.text();

            throw new Error(
                "DeepSeek: " + error
            );
        }

        const data =
            await response.json();

        return data
            .choices?.[0]
            ?.message
            ?.content
            || "";
    }

    async function askClaude(
        apiKey,
        prompt,
        code,
        language
    ) {

        const response =
            await fetch(
                "https://api.anthropic.com/v1/messages",
                {
                    method: "POST",

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
                            16000,

                        system: `
You are MBGee AI Writer.

Programming language:
${language}

Return only usable code.

Do not use Markdown fences.
`,

                        messages: [

                            {
                                role: "user",

                                content: `
CURRENT CODE:

${code}

REQUEST:

${prompt}
`
                            }
                        ]
                    })
                }
            );

        if (!response.ok) {

            const error =
                await response.text();

            throw new Error(
                "Claude: " + error
            );
        }

        const data =
            await response.json();

        return data
            .content
            ?.map(
                x => x.text || ""
            )
            .join("")
            || "";
    }

    async function askAI(
        settings,
        prompt,
        code,
        language
    ) {

        if (!settings.apiKey) {

            throw new Error(
                "API key has not been configured."
            );
        }

        if (
            settings.provider ===
            "gemini"
        ) {

            return askGemini(
                settings.apiKey,
                prompt,
                code,
                language
            );
        }

        if (
            settings.provider ===
            "openai"
        ) {

            return askOpenAI(
                settings.apiKey,
                prompt,
                code,
                language
            );
        }

        if (
            settings.provider ===
            "deepseek"
        ) {

            return askDeepSeek(
                settings.apiKey,
                prompt,
                code,
                language
            );
        }

        if (
            settings.provider ===
            "claude"
        ) {

            return askClaude(
                settings.apiKey,
                prompt,
                code,
                language
            );
        }

        throw new Error(
            "Unknown AI provider."
        );
    }

    async function humanWrite(
        text,
        status
    ) {

        const editor =
            getEditor();

        if (!editor) {
            return;
        }

        setCode("");

        let output = "";

        /*
            Human-style writing effect.

            The AI generates the actual code.
            This function controls how quickly
            characters appear in Acode.
        */

        for (
            let i = 0;
            i < text.length;
            i++
        ) {

            output += text[i];

            editor.setValue(
                output
            );

            if (
                text[i] === "\n"
            ) {

                await sleep(25);

            } else if (
                text[i] === " "
            ) {

                await sleep(4);

            } else {

                await sleep(8);
            }

            if (
                i % 20 === 0
            ) {

                status.textContent =
                    `Writing code... ${i + 1}/${text.length}`;
            }
        }

        status.textContent =
            "✓ Finished writing.";
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

    function openSettings() {

        const settings =
            loadSettings();

        page.innerHTML = `

            <div class="mbgee-settings">

                <h2>MBGee AI Writer</h2>

                <p>
                    AI Coding Assistant
                </p>

                <label>
                    AI Provider
                </label>

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
                    API Key
                </label>

                <input
                    id="apiKey"
                    type="password"
                    placeholder="Paste your API key"
                />

                <button
                    id="saveSettings"
                    class="primary"
                >
                    Save
                </button>

                <button
                    id="back"
                >
                    Back
                </button>

                <p id="settingsStatus"></p>

            </div>
        `;

        page.show();

        page.querySelector(
            "#provider"
        ).value =
            settings.provider;

        page.querySelector(
            "#apiKey"
        ).value =
            settings.apiKey;

        page.querySelector(
            "#saveSettings"
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

            page.querySelector(
                "#settingsStatus"
            ).textContent =
                "✓ Settings saved.";

            setTimeout(
                openWriter,
                500
            );
        };

        page.querySelector(
            "#back"
        ).onclick =
            openWriter;
    }

    function openWriter() {

        const settings =
            loadSettings();

        page.innerHTML = `

            <div class="mbgee-wrap">

                <div class="header">

                    <div>

                        <strong>
                            MBGee AI Writer
                        </strong>

                        <small>
                            Human-style AI coding
                        </small>

                    </div>

                    <button id="settings">
                        ⚙
                    </button>

                </div>

                <textarea
                    id="prompt"
                    placeholder="Tell me what you want to code..."
                ></textarea>

                <button
                    id="generate"
                    class="primary"
                >
                    Generate & Write
                </button>

                <div class="actions">

                    <button data-mode="Fix the current code.">
                        Fix
                    </button>

                    <button data-mode="Complete the current code.">
                        Complete
                    </button>

                    <button data-mode="Improve the current code.">
                        Improve
                    </button>

                    <button data-mode="Explain the current code.">
                        Explain
                    </button>

                </div>

                <div
                    id="status"
                    class="status"
                >
                    ${
                        settings.apiKey
                        ? "Ready."
                        : "API key required."
                    }
                </div>

                <div class="info">

                    Provider:
                    <b>
                        ${
                            settings.provider
                        }
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

        async function run(
            instruction
        ) {

            const status =
                page.querySelector(
                    "#status"
                );

            const prompt =
                page.querySelector(
                    "#prompt"
                ).value.trim();

            if (!prompt) {

                status.textContent =
                    "Tell the AI what you want.";

                return;
            }

            try {

                status.textContent =
                    "Thinking...";

                const code =
                    getCode();

                const language =
                    getLanguage();

                const result =
                    await askAI(
                        loadSettings(),
                        `${instruction}

USER REQUEST:
${prompt}`,
                        code,
                        language
                    );

                const clean =
                    cleanCode(
                        result
                    );

                if (!clean.trim()) {

                    throw new Error(
                        "The AI returned no code."
                    );
                }

                await humanWrite(
                    clean,
                    status
                );

            } catch (error) {

                status.textContent =
                    "Error: " +
                    error.message;
            }
        }

        page.querySelector(
            "#generate"
        ).onclick =
            () =>
                run(
                    "Generate the requested code."
                );

        page.querySelectorAll(
            "[data-mode]"
        ).forEach(
            button => {

                button.onclick =
                    () =>
                        run(
                            button.dataset.mode
                        );
            }
        );
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
                "Open MBGee AI Writer",

            exec:
                openWriter
        });
    }

    function unmount() {

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
