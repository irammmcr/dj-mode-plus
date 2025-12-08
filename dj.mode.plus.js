// ============================
// DJ MODE+ (fix -p -> prefer library playlists)
// ============================

(function () {
    if (!Spicetify || !Spicetify.Player || !Spicetify.CosmosAsync) {
        setTimeout(arguments.callee, 500);
        return;
    }

    console.log("DJ Mode+ loaded (playlist library fix)");

    // ============================
    // HELPERS
    // ============================
    function notify(text) {
        try {
            Spicetify.showNotification(`DJ Mode+: ${text}`);
        } catch {}
    }

    // parse prompt: supports suffixes -a, -e, -p, -r and optional -o to open page.
    // examples: "Name -a", "Name -ao", "Name -po", "Name -o"
    function parsePrompt(raw) {
        let input = raw.trim();
        let openPage = false;

        // normalize spaces and lower for suffix detection but keep original for query case
        const lower = input.toLowerCase();

        // handle combined suffix like "-ao", "-eo", "-po"
        const comboMatch = lower.match(/(.+?)\s*-(a|e|p|r)o$/);
        if (comboMatch) {
            openPage = true;
            const q = comboMatch[1].trim();
            const suf = comboMatch[2];
            return { mode: suf === "a" ? "album" : suf === "e" ? "ep" : suf === "p" ? "playlist" : "repeat", query: q, openPage: true };
        }

        // handle single suffix with -o like "name -o"
        const singleOpenMatch = lower.match(/(.+?)\s*-o$/);
        if (singleOpenMatch) {
            input = singleOpenMatch[1].trim();
            openPage = true;
        }

        // handle single suffixes -a -e -p -r
        const sufMatch = input.match(/(.+?)\s*-(a|e|p|r)$/i);
        if (sufMatch) {
            const q = sufMatch[1].trim();
            const suf = sufMatch[2].toLowerCase();
            return { mode: suf === "a" ? "album" : suf === "e" ? "ep" : suf === "p" ? "playlist" : "repeat", query: q, openPage };
        }

        // no suffix (but maybe originally had -o detection earlier)
        return { mode: "smart", query: input, openPage };
    }

    async function spotifySearch(query, type, limit = 5) {
        const res = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`,
            {
                headers: {
                    Authorization: `Bearer ${Spicetify.Platform.Session.accessToken}`
                }
            }
        );
        return await res.json();
    }

    function openURI(uri) {
        try {
            const parsed = Spicetify.URI.fromString(uri);
            const id = parsed.id || parsed._base62Id;
            let path = "";

            if (parsed.type === "artist") path = `/artist/${id}`;
            else if (parsed.type === "album") path = `/album/${id}`;
            else if (parsed.type === "playlist" || parsed.type === "playlist_v2") path = `/playlist/${id}`;
            else if (parsed.type === "track") path = `/track/${id}`;

            if (path) {
                Spicetify.Platform.History.push(path);
                notify("Opened page");
            }
        } catch (e) {
            console.warn("Navigation error", e);
        }
    }

    // ============================
    // LIBRARY PLAYLIST HELPERS
    // ============================

    // returns array of playlist objects from rootlist (flat)
    async function getLibraryPlaylists() {
        try {
            const res = await Spicetify.CosmosAsync.get("sp://core-playlist/v1/rootlist", { policy: { folder: { rows: true, link: true } } });
            const rows = res.rows ?? [];
            const playlists = [];

            (function scan(rlist) {
                for (const r of rlist) {
                    if (!r) continue;
                    if (r.type === "playlist") playlists.push(r);
                    if (r.type === "folder" && r.rows) scan(r.rows);
                }
            })(rows);

            return playlists;
        } catch (e) {
            console.warn("Failed to fetch library playlists", e);
            return [];
        }
    }

    // try to find playlist from library by name substring (case-insensitive)
    async function findLibraryPlaylistByName(query) {
        const lib = await getLibraryPlaylists();
        if (!lib.length) return null;
        const q = query.toLowerCase();
        // exact match priority
        let found = lib.find(p => (p.name ?? "").toLowerCase() === q);
        if (found) return found;
        // substring
        found = lib.find(p => (p.name ?? "").toLowerCase().includes(q));
        return found ?? null;
    }

    // ============================
    // PLAY LOGIC
    // ============================

    async function playAlbumOrEP(query, isEP, openPage) {
        try {
            const data = await spotifySearch(query, "album", 6);
            const albums = data.albums?.items;
            if (!albums?.length) return notify("No album found");

            const album =
                albums.find(a =>
                    isEP
                        ? a.album_type === "single" || a.total_tracks <= 6
                        : a.album_type === "album"
                ) || albums[0];

            await Spicetify.Player.playUri(album.uri);
            notify(isEP ? `EP: ${album.name}` : `Album: ${album.name}`);

            if (openPage) openURI(album.uri);
        } catch (e) {
            console.error("playAlbumOrEP error", e);
            notify("Album playback error");
        }
    }

    async function playPlaylist(query, openPage) {
        try {
            // 1) Try library first (includes saved playlists / private ones)
            const libMatch = await findLibraryPlaylistByName(query);
            if (libMatch) {
                // libMatch.link is typically the spotify uri (e.g. spotify:playlist:...)
                const uri = libMatch.link ?? libMatch.uri ?? libMatch.link?.link ?? null;
                if (uri) {
                    await Spicetify.Player.playUri(uri);
                    notify(`Playlist: ${libMatch.name}`);
                    if (openPage) openURI(uri);
                    return;
                }
            }

            // 2) Fallback: public search
            const data = await spotifySearch(query, "playlist", 10);
            const playlists = data.playlists?.items ?? [];
            if (!playlists.length) return notify("Playlist not found");

            // prefer a playlist that you own if possible
            const userId = Spicetify.Platform.Session.username || Spicetify.Platform.Session.user_id || null;
            let chosen = playlists.find(p => p.owner?.id === userId) || playlists[0];

            await Spicetify.Player.playUri(chosen.uri);
            notify(`Playlist: ${chosen.name}`);
            if (openPage) openURI(chosen.uri);
        } catch (e) {
            console.error("playPlaylist error", e);
            notify("Playlist playback error");
        }
    }

    async function playRepeatTrack(query) {
        try {
            const data = await spotifySearch(query, "track", 1);
            const track = data.tracks?.items?.[0];
            if (!track) return notify("Track not found");

            await Spicetify.Player.playUri(track.uri);

            try {
                if (Spicetify.Platform?.PlayerAPI?.setRepeat) Spicetify.Platform.PlayerAPI.setRepeat(2);
                else if (Spicetify.Player?.setRepeat) Spicetify.Player.setRepeat("track");
            } catch (e) {
                console.warn("setRepeat failed", e);
            }

            notify(`Repeating: ${track.name}`);
        } catch (e) {
            console.error("playRepeatTrack error", e);
            notify("Repeat playback error");
        }
    }

    async function playSmart(prompt) {
        try {
            const { mode, query, openPage } = parsePrompt(prompt);

            if (mode === "album") return playAlbumOrEP(query, false, openPage);
            if (mode === "ep") return playAlbumOrEP(query, true, openPage);
            if (mode === "playlist") return playPlaylist(query, openPage);
            if (mode === "repeat") return playRepeatTrack(query);

            // SMART default: tracks
            const res = await spotifySearch(query, "track", 10);
            const tracks = res.tracks?.items;
            if (!tracks?.length) return notify("Nothing found");

            const uris = tracks.map(t => t.uri);

            await Spicetify.Player.playUri(uris[0]);

            try { Spicetify.Queue.clear(); } catch {}
            for (let i = 1; i < uris.length; i++) {
                try { Spicetify.Queue.enqueue(uris[i]); } catch {}
            }

            try {
                if (Spicetify.Platform?.PlayerAPI?.setRepeat) Spicetify.Platform.PlayerAPI.setRepeat(0);
                else if (Spicetify.Player?.setRepeat) Spicetify.Player.setRepeat("off");
            } catch (e) {}

            notify(`DJ mix: ${tracks[0].artists[0].name}`);

            if (openPage) {
                const firstArtistUri = tracks[0]?.artists?.[0]?.uri;
                if (firstArtistUri) openURI(firstArtistUri);
            }
        } catch (e) {
            console.error("playSmart error", e);
            notify("DJ Mode+ error");
        }
    }

    // ============================
    // MODAL
    // ============================

    let djModal;

    function createDJModal() {
        if (djModal) return;

        djModal = document.createElement("div");
        djModal.style.display = "none";
        djModal.innerHTML = `
            <div class="dj-overlay">
                <div class="dj-box">
                    <input id="dj-input" placeholder="What do you want to play?" />
                </div>
            </div>
        `;

        document.body.appendChild(djModal);

        const style = document.createElement("style");
        style.textContent = `
            .dj-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.55);
                backdrop-filter: blur(6px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
            }
            .dj-box {
                width: 60%;
                max-width: 720px;
                background: var(--spice-main);
                border-radius: 999px;
                padding: 18px 24px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.6);
            }
            #dj-input {
                width: 100%;
                font-size: 20px;
                background: transparent;
                border: none;
                outline: none;
                color: var(--spice-text);
            }
        `;
        document.head.appendChild(style);

        const input = djModal.querySelector("#dj-input");
        input.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                const value = input.value.trim();
                closeDJModal();
                if (value) playSmart(value);
            }
            if (e.key === "Escape") closeDJModal();
        });
    }

    function openDJModal() {
        createDJModal();
        djModal.style.display = "block";
        const input = djModal.querySelector("#dj-input");
        input.value = "";
        setTimeout(() => input.focus(), 50);
    }

    function closeDJModal() {
        if (djModal) djModal.style.display = "none";
    }

    // ============================
    // BUTTON + KEYBIND
    // ============================

    document.addEventListener("keydown", e => {
        if (e.ctrlKey && e.code === "Space") {
            e.preventDefault();
            openDJModal();
        }
        if (e.key === "Escape") closeDJModal();
    });

    function injectButton() {
        const bar = document.querySelector('[data-testid="topbar"]');
        if (!bar || document.getElementById("dj-mode-btn")) return;

        const btn = document.createElement("button");
        btn.id = "dj-mode-btn";
        btn.textContent = "DJ";
        btn.style.marginLeft = "12px";
        btn.style.padding = "6px 14px";
        btn.style.borderRadius = "999px";
        btn.style.border = "none";
        btn.style.background = "#1db954";
        btn.style.color = "#000";
        btn.style.fontWeight = "700";
        btn.style.cursor = "pointer";
        btn.onclick = openDJModal;

        bar.appendChild(btn);
    }

    new MutationObserver(injectButton).observe(document.body, {
        childList: true,
        subtree: true
    });

})();
