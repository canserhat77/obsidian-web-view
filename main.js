'use strict';

const { Plugin, ItemView, Modal, Setting, Notice } = require('obsidian');

const VIEW_TYPE_WEB = 'web-view';
const TOOLBAR_H = 36;

// ─── WebView leaf ────────────────────────────────────────────────────────────

class WebView extends ItemView {
    constructor(leaf) {
        super(leaf);
        this.url = 'about:blank';
        this.pageTitle = 'Web View';
        this.navigation = true;
    }

    getViewType() { return VIEW_TYPE_WEB; }
    getDisplayText() { return this.pageTitle; }
    getIcon() { return 'globe'; }

    async onOpen() {
        this.build();
    }

    async onClose() {
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._handleWindowResize) {
            window.removeEventListener('resize', this._handleWindowResize);
            this._handleWindowResize = null;
        }
    }

    build() {
        // Tear down any previous resize observer
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._handleWindowResize) {
            window.removeEventListener('resize', this._handleWindowResize);
            this._handleWindowResize = null;
        }

        // contentEl is Obsidian's official API for the view's content area
        const root = this.contentEl;
        this.root = root;
        this.containerEl.style.setProperty('height', '100%');
        this.containerEl.style.setProperty('min-height', '0');
        this.containerEl.style.setProperty('display', 'flex');
        this.containerEl.style.setProperty('flex-direction', 'column');
        root.empty();
        root.addClass('web-view-root');
        root.style.cssText = 'padding:0; overflow:hidden; position:relative; width:100%; height:100%; min-height:0; flex:1 1 auto;';
        root.parentElement?.style.setProperty('min-height', '0');

        // ── Toolbar ──────────────────────────────────────────────────────────
        const toolbar = root.createDiv({ cls: 'web-view-toolbar' });

        this.backBtn    = toolbar.createEl('button', { text: '←', cls: 'web-view-nav-btn', attr: { title: 'Back' } });
        this.forwardBtn = toolbar.createEl('button', { text: '→', cls: 'web-view-nav-btn', attr: { title: 'Forward' } });
        this.reloadBtn  = toolbar.createEl('button', { text: '↺', cls: 'web-view-nav-btn', attr: { title: 'Reload' } });

        this.urlBar = toolbar.createEl('input', {
            cls: 'web-view-url-bar',
            attr: { type: 'text', placeholder: 'https://', value: this.url }
        });

        this.externalBtn = toolbar.createEl('button', {
            text: '⧉',
            cls: 'web-view-nav-btn',
            attr: { title: 'Open in default browser' }
        });

        // ── Webview — created after layout is known ───────────────────────────
        // Electron locks the render viewport at the size the webview has when
        // src is first set. We defer creation to rAF so clientHeight is final.
        this._sizeReady = false;

        requestAnimationFrame(() => {
            if (!root.isConnected) return;

            const { width, height } = this._getWebviewSize(root);

            this.wv = root.createEl('webview', { cls: 'web-view-frame' });
            this.wv.setAttribute('allowpopups', '');
            this.wv.setAttribute('autosize', 'on');
            this.wv.setAttribute('minwidth', '0');
            this.wv.setAttribute('minheight', '0');
            this.wv.setAttribute('maxwidth', String(width));
            this.wv.setAttribute('maxheight', String(height));
            // Set correct pixel dimensions before src so the render viewport
            // is initialised at full size.
            this._applyWebviewSize(width, height);

            // Force layout flush, then set src on the next compositor frame
            void this.wv.offsetHeight;
            requestAnimationFrame(() => {
                if (this.wv) {
                    const { width, height } = this._getWebviewSize(root);
                    this._applyWebviewSize(width, height);
                    this._sizeReady = true;
                    this.wv.setAttribute('src', this.url);
                    this._wireEvents();
                    window.setTimeout(() => {
                        if (!this.wv) return;
                        const { width, height } = this._getWebviewSize(root);
                        this._applyWebviewSize(width, height);
                    }, 250);
                }
            });

            // Keep dimensions in sync when the pane is resized
            this._ro = new ResizeObserver(() => {
                if (!this.wv) return;
                const { width, height } = this._getWebviewSize(root);
                this._applyWebviewSize(width, height);
            });
            this._ro.observe(root);
            const leafContent = root.closest('.workspace-leaf-content');
            if (leafContent) this._ro.observe(leafContent);
            if (this.containerEl) this._ro.observe(this.containerEl);
            window.addEventListener('resize', this._handleWindowResize = () => {
                if (!this.wv) return;
                const { width, height } = this._getWebviewSize(root);
                this._applyWebviewSize(width, height);
            });
        });

        // ── Toolbar event wiring (available immediately) ──────────────────────
        this.backBtn.addEventListener('click',    () => this.wv && this.wv.goBack());
        this.forwardBtn.addEventListener('click', () => this.wv && this.wv.goForward());
        this.reloadBtn.addEventListener('click',  () => this.wv && this.wv.reload());

        this.externalBtn.addEventListener('click', () => {
            require('electron').shell.openExternal(this.url);
        });

        this.urlBar.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            this.navigate(this.urlBar.value.trim());
        });
    }

    _getWebviewSize(root) {
        const leafContent = root.closest('.workspace-leaf-content');
        const rootRect = root.getBoundingClientRect();
        const leafRect = leafContent?.getBoundingClientRect();
        const containerRect = this.containerEl?.getBoundingClientRect();
        const width = Math.max(root.clientWidth, Math.floor(rootRect.width), leafContent?.clientWidth || 0, Math.floor(containerRect?.width || 0));
        const measuredHeight = Math.floor(rootRect.height);
        const leafAvailableHeight = leafRect ? Math.floor(leafRect.bottom - rootRect.top) : 0;
        const containerAvailableHeight = containerRect ? Math.floor(containerRect.bottom - rootRect.top) : 0;
        const windowAvailableHeight = Math.floor(window.innerHeight - rootRect.top);
        const contentHeight = Math.max(root.clientHeight, measuredHeight, leafAvailableHeight, containerAvailableHeight, windowAvailableHeight);
        const height = Math.max(0, contentHeight - TOOLBAR_H);
        return { width, height };
    }

    _applyWebviewSize(width, height) {
        if (!this.wv) return;
        if (this.root) {
            this.root.style.height = height + TOOLBAR_H + 'px';
        }
        this.wv.setAttribute('width', String(width));
        this.wv.setAttribute('height', String(height));
        this.wv.setAttribute('maxwidth', String(width));
        this.wv.setAttribute('maxheight', String(height));
        this.wv.style.setProperty('display', 'inline-flex', 'important');
        this.wv.style.setProperty('position', 'absolute', 'important');
        this.wv.style.setProperty('top', TOOLBAR_H + 'px', 'important');
        this.wv.style.setProperty('left', '0', 'important');
        this.wv.style.setProperty('right', '0', 'important');
        this.wv.style.setProperty('bottom', '0', 'important');
        this.wv.style.setProperty('width', width + 'px', 'important');
        this.wv.style.setProperty('height', height + 'px', 'important');
    }

    _wireEvents() {
        if (!this.wv) return;
        this.wv.addEventListener('did-navigate',         (e) => this.onNavigate(e.url));
        this.wv.addEventListener('did-navigate-in-page', (e) => this.onNavigate(e.url));

        this.wv.addEventListener('page-title-updated', (e) => {
            this.pageTitle = e.title || 'Web View';
            this.titleEl.setText(this.pageTitle);
        });

        this.wv.addEventListener('new-window', (e) => {
            const plugin = this.app.plugins.getPlugin('web-view');
            if (plugin) plugin.openUrl(e.url);
        });
    }

    onNavigate(url) {
        this.url = url;
        if (this.urlBar) this.urlBar.value = url;
    }

    navigate(url) {
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        this.url = url;
        if (this.urlBar) this.urlBar.value = url;

        // If the webview hasn't been sized yet, just update this.url —
        // the ResizeObserver's first callback will call setAttribute('src')
        // once the correct height is known.
        if (!this._sizeReady) return;

        const load = () => {
            if (typeof this.wv.loadURL === 'function') {
                this.wv.loadURL(url);
            } else {
                this.wv.setAttribute('src', url);
            }
        };

        try {
            load();
        } catch (_) {
            this.wv.addEventListener('dom-ready', load, { once: true });
        }
    }

    async setState(state, result) {
        if (state && state.url) {
            this.url = state.url;
            if (this.wv) this.navigate(state.url);
        }
        await super.setState(state, result);
    }

    getState() {
        return { url: this.url };
    }

    getSizeReport() {
        const rect = (el) => {
            if (!el) return 'missing';
            const r = el.getBoundingClientRect();
            return `${Math.round(r.width)}x${Math.round(r.height)} @ ${Math.round(r.left)},${Math.round(r.top)}`;
        };

        return [
            `window ${window.innerWidth}x${window.innerHeight}`,
            `container ${rect(this.containerEl)}`,
            `content ${rect(this.root || this.contentEl)}`,
            `webview ${rect(this.wv)}`,
            `webview attr ${this.wv?.getAttribute('width') || '?'}x${this.wv?.getAttribute('height') || '?'}`,
            `webview css ${this.wv?.style.width || '?'} x ${this.wv?.style.height || '?'}`,
        ].join('\n');
    }
}

// ─── URL-input modal ─────────────────────────────────────────────────────────

class UrlModal extends Modal {
    constructor(app, onSubmit) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: 'Open URL in Web View' });

        let url = '';

        new Setting(contentEl)
            .setName('URL')
            .addText((text) => {
                text.setPlaceholder('https://example.com')
                    .onChange((v) => { url = v; });
                text.inputEl.style.width = '100%';
                text.inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { this.close(); this.onSubmit(url); }
                });
                window.setTimeout(() => text.inputEl.focus(), 30);
            });

        new Setting(contentEl)
            .addButton((btn) =>
                btn.setButtonText('Open').setCta().onClick(() => {
                    this.close();
                    this.onSubmit(url);
                })
            );
    }

    onClose() { this.contentEl.empty(); }
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

class WebViewPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_WEB, (leaf) => new WebView(leaf));

        this._handleOpenUrl = (evt) => {
            const url = evt.detail && evt.detail.url;
            if (!url || !/^https?:\/\//i.test(url)) return;
            evt.preventDefault();
            this.openUrl(url);
        };

        window.addEventListener('open-url', this._handleOpenUrl, true);
        this.register(() => window.removeEventListener('open-url', this._handleOpenUrl, true));

        this.addCommand({
            id: 'open-url',
            name: 'Open URL in Web View',
            callback: () => new UrlModal(this.app, (url) => this.openUrl(url)).open(),
        });

        this.addCommand({
            id: 'open-clipboard-url',
            name: 'Open clipboard URL in Web View',
            callback: async () => {
                const text = await navigator.clipboard.readText().catch(() => '');
                if (/^https?:\/\//i.test(text.trim())) {
                    this.openUrl(text.trim());
                } else {
                    new Notice('Clipboard does not contain a valid HTTP(S) URL.');
                }
            },
        });

        this.addCommand({
            id: 'show-web-view-size',
            name: 'Show Web View Size',
            checkCallback: (checking) => {
                const view = this.app.workspace.getActiveViewOfType(WebView);
                if (!view) return false;
                if (!checking) {
                    const report = view.getSizeReport();
                    console.log('[web-view] size report\n' + report);
                    new Notice(report, 15000);
                }
                return true;
            },
        });
    }

    async openUrl(url) {
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: VIEW_TYPE_WEB, active: true, state: { url } });
        this.app.workspace.revealLeaf(leaf);
    }

    onunload() {}
}

module.exports = WebViewPlugin;
