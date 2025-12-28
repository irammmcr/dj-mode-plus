// ============================
// DJ MODE+ (STABLE SEARCH FIXED)
// Compatible Spotify 1.2.79+
// ============================

(function () {
    if (!window.Spicetify || !Spicetify.Player || !Spicetify.Platform) {
        setTimeout(arguments.callee, 500);
        return;
    }

    console.log("DJ Mode+ loaded (stable)");

    // ============================
    // MEMORY
    // ============================

    const DJ_MEMORY_KEY = "dj_mode_plus_memory_v2";

    const djMemory = JSON.parse(localStorage.getItem(DJ_MEMORY_KEY)) || {
        lastCommand: null
    };

    function saveMemory() {
        localStorage.setItem(DJ_MEMORY_KEY, JSON.stringify(djMemory));
    }

    // ============================
    // HELPERS
    // ============================

    function notify(text) {
        try {
            Spicetify.showNotification(`DJ Mode+: ${text}`);
        } catch {}
    }

    function playSearch(query) {
        const uri = `spotify:search:${encodeURIComponent(query)}`;
        Spicetify.Player.playUri(uri);
        notify(query);
    }

    function openSearch(query) {
        Spicetify.Platform.History.push(
            `/search/${encodeURIComponent(query)}`
        );
    }

    async function addToQueue(uri) {
        try {
            await Spicetify.Platform.PlayerAPI.addToQueue(uri);
        } catch {}
    }

    // ============================
    // PARSER
    // ============================

    function parsePrompt(raw) {
        const input = raw.trim();

        if (input.toLowerCase() === "-rec") {
            return { mode: "rec" };
        }

        const mix = input.match(/^(.+?)\s+x\s+(.+)$/i);
        if (mix) {
            return { mode: "mix", a1: mix[1].trim(), a2: mix[2].trim() };
        }

        let openPage = false;
        let text = input;

        if (text.toLowerCase().endsWith("-o")) {
            openPage = true;
            text = text.slice(0, -2).trim();
        }

        const suffix = text.match(/(.+?)\s*-(r|g)$/i);
        if (suffix) {
            return {
                query: suffix[1].trim(),
                mode: suffix[2] === "g" ? "genre" : "repeat",
                openPage
            };
        }

        return { mode: "search", query: text, openPage };
    }

    // ============================
    // PLAY LOGIC
    // ============================

    function playMix(a1, a2) {
        const q = `${a1} ${a2}`;
        playSearch(q);
        notify(`${a1} x ${a2}`);
    }

    async function playFromHistory() {
        try {
            const data = await Spicetify.CosmosAsync.get(
                "https://api.spotify.com/v1/me/player/recently-played?limit=20"
            );

            const tracks = data?.items
                ?.map(i => i.track?.uri)
                .filter(Boolean);

            if (!tracks?.length) {
                notify("No history");
                return;
            }

            await Spicetify.Player.playUri(tracks[0]);
            for (let i = 1; i < tracks.length; i++) {
                await addToQueue(tracks[i]);
            }

            notify("From your history");
        } catch {
            notify("History error");
        }
    }

    // ============================
    // SMART INPUT (FIXED)
    // ============================

    function playSmart(input) {
        const p = parsePrompt(input);

        djMemory.lastCommand = input;
        saveMemory();

        if (p.mode === "mix") {
            playMix(p.a1, p.a2);
            return;
        }

        if (p.mode === "rec") {
            playFromHistory();
            return;
        }

        if (p.mode === "repeat") {
            playSearch(p.query);
            Spicetify.Platform.PlayerAPI.setRepeat(2);
            notify(`Repeating: ${p.query}`);
            return;
        }

        if (p.mode === "genre") {
            playSearch(p.query);
            if (p.openPage) openSearch(p.query);
            return;
        }

        // DEFAULT SEARCH (NO API)
        playSearch(p.query);
        if (p.openPage) openSearch(p.query);
    }

    // ============================
    // UI
    // ============================

    let modal = null;

    function openModal() {
        if (!modal) {
            modal = document.createElement("div");
            modal.innerHTML = `
                <div style="
                    position:fixed;
                    inset:0;
                    background:rgba(0,0,0,.6);
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    z-index:9999;
                ">
                    <input id="dj-input"
                        style="
                            width:60%;
                            font-size:20px;
                            padding:16px 22px;
                            border-radius:999px;
                            border:none;
                            outline:none;
                        "
                        placeholder="DJ Mode+ command…" />
                </div>
            `;
            document.body.appendChild(modal);

            const input = modal.querySelector("#dj-input");

            input.addEventListener("keydown", e => {
                if (e.key === "Enter") {
                    modal.style.display = "none";
                    const value = input.value.trim();
                    if (value) playSmart(value);
                }

                if (e.key === "Escape") {
                    modal.style.display = "none";
                }
            });
        }

        modal.style.display = "flex";
        const input = modal.querySelector("#dj-input");
        input.value = "";
        input.focus();
    }

    // ============================
    // HOTKEYS (FIXED)
    // ============================

    document.addEventListener("keydown", e => {
        // Ctrl + Space → abrir DJ
        if (e.ctrlKey && !e.shiftKey && e.code === "Space") {
            e.preventDefault();
            openModal();
        }

        // Ctrl + Shift + Space → repetir último comando
        if (e.ctrlKey && e.shiftKey && e.code === "Space") {
            e.preventDefault();

            if (djMemory.lastCommand) {
                playSmart(djMemory.lastCommand);
                notify("Last command");
            }
        }
    });

})();
