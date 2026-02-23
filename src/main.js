import path from 'path'
import fs from 'fs'
import cli from 'cli-color'
import { execFile } from 'child_process';
import { normalizePath, loadEnv } from 'vite';
import { fileURLToPath } from 'url';

/**
 * Encapsulates a regex pattern used to inject `await` into dynamic imports
 * at the generateBundle post-processing stage.
 */
class BalafonEmitRegex {
    #ref; #regex; #replace;

    constructor(ref, regex, replace) {
        this.#ref = ref;
        this.#regex = regex || '\\(async\\s*\\(\\s*\\)\\s*=>\\s*await\\s+import\\(new\\s+URL\\("[filename]"';
        this.#replace = replace || 'await $&';
    }

    get replace() { return this.#replace; }
    get source()  { return this.#regex; }
    get ref()     { return this.#ref; }

    regex(context, filename) {
        let v_filename = context.getFileName(this.#ref);
        let relative = path.relative('/' + path.dirname(filename), '/' + v_filename);
        v_filename = relative
            .replace(/\./g, '\\.')
            .replace(/\//g, '\\/');
        let s = this.#regex.replace('[filename]', v_filename);
        return new RegExp(s, 'g');
    }
}

/**
 * @param {*} option
 * @returns {string}
 */
function chunkPrefix(option) {
    return option.buildCoreAssetOutput ?? 'balafon';
}

function _getSrvComponents(option) {
    return option.serverComponentPrefix || 'srv-components/';
}

/**
 * treat identifier — wraps name in quotes when it is not a valid JS identifier
 * @param {String} name
 */
function _identifier(name) {
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
        name = '"' + name + '"';
    }
    return name;
}

/**
 * get rollup file url
 * @param {string} ref
 * @returns {string}
 */
function _rollup_uri(ref) {
    return 'import.meta.ROLLUP_FILE_URL_' + ref;
}

/**
 * @param {*} file file to load
 * @param {*} g_components list of g_components
 * @param {*} _p_vue_plugin
 * @param {string} _id identifier without \0
 * @returns
 */
async function _loadVueFile(file, g_components, _p_vue_plugin, _id) {
    let code = fs.readFileSync(file, 'utf-8');
    try {
        code = code ? await _helper_transform(_p_vue_plugin, code, _id + '.vue') : null;
        if (!code) {
            console.error('null defined .... ', { file, _id });
            return;
        }
        g_components[_id] = code;
    } catch (e) {
        if (!is_prod) {
            console.log("failed to transform ", file);
            console.error(e);
        }
        g_components[_id] = 'const d = null; export { d as default }';
        return false;
    }
};

/**
 * invalidate module importer code
 * @param {*} mod_graph
 * @param {*} v_mod
 * @param {boolean} send - whether to send a ws update
 * @param {*} [server] - Vite dev server (required when send=true)
 */
function _invalidateModuleImporter(mod_graph, v_mod, send, server) {
    // + | invalidate importers chains
    let pops = [v_mod.importers];
    const lf = {};
    while (pops.length > 0) {
        let q = pops.shift();

        for (let imod of q) {
            // invalidate importer so that it can reload the necessary plugin -
            if (imod.id in lf) continue;
            lf[imod.id] = ((id, file) => (({ id, file } = imod)))();
            mod_graph.invalidateModule(imod);
            if (imod.importers) {
                pops.unshift(imod.importers);
            }
            // send
            if (send && server) {
                server.ws.send({
                    type: 'update',
                    updates: [
                        {
                            type: 'js-update',
                            path: imod.url || imod.file,
                            acceptedPath: imod.url || imod.file
                        },
                    ]
                });
            }
        }
    }
}

/**
 * Create a per-instance Vue plugin finder with memoised result.
 * @returns {function(plugins: any[]): any}
 */
function _createVueFinder() {
    let _cache = null;
    return function _vue_(plugins) {
        if (_cache !== null) return _cache || null;
        _cache = plugins.find(p => p.name === 'vite:vue') ?? false;
        return _cache || null;
    };
}

const __PLUGIN_NAME__ = 'vite-plugin-balafon'
const __dirname = process.env.PWD;
const __baseOptions = {
    controller: null,
    cwdir: null,
    app_name: null,
    leaveIndexHtml: false,
    defaultUser: null,
    target: '#app',
    usePiniaStore: false,
    useRoute: false,
    logo: null
};
const mode = process.env.NODE_ENV ?? 'development';
const is_prod = mode == 'production';

/**
 * Create an isolated watch-file registry array.
 * Buffers watcher.add() calls made before the dev server is available.
 */
function _createWatchFile() {
    const t = [];
    const _orig_push = Array.prototype.push.bind(t);
    let m_plist = [];
    const m_reg = {};

    t.push = function (...a) {
        if (t.server) {
            if (!t.watchList) t.watchList = {};
            if (m_plist.length > 0) {
                a.push(...m_plist);
                m_plist = []; // flush pending items exactly once
            }
            a.forEach(i => {
                if (i && !(i in t.watchList)) {
                    t.server.watcher.add(i);
                    t.watchList[i] = 1;
                }
            });
        } else {
            a.forEach(p => { m_plist.push(p); });
        }
        return _orig_push(...a);
    };

    t.getId = function (i) { return m_reg[i]; };
    t.store = function (id, f) {
        t.push(f);
        m_reg[f] = "\0" + id.replace("\0", "");
    };

    return t;
}

/**
 * Create an isolated file-watch listener hub.
 */
function _createWatchListener() {
    const m_listener = [];
    const m_registry = {};
    let m_server = null;
    const self = Object.create(null);

    Object.defineProperty(self, 'registry', { get() { return m_registry; } });
    Object.defineProperty(self, 'server', {
        get() { return m_server; },
        set(v) { m_server = v; }
    });
    self.handle = function (f) {
        let e = false;
        m_listener.forEach(c => { e = e || c.apply(self, [f]); });
        return e;
    };
    self.register = function (listener) { m_listener.push(listener); };
    self.clear = function () { m_listener.length = 0; }; // fixed: was this.m_listener

    return self;
}

/**
 * get export file
 * @param {*} file
 * @returns
 */
function _fs_exports(file) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    return __dirname + "/exports/" + file;
}

/**
 * Initialise the Balafon app environment by calling the CLI once.
 * @param {*} option
 * @param {*} __app_environment shared mutable environment object
 */
async function init_env(option, __app_environment) {
    if ('_init' in __app_environment) {
        let p = await exec_cmd(["--env", "--no-color"], option);
        delete (__app_environment['_init'])
        if (p) {
            merge_properties(__app_environment, JSON.parse(p));
        }
    }
    return __app_environment;
}


const merge_properties = (obj, prop, merge) => {
    if (!obj) return prop;
    if (merge == undefined) {
        merge = false;
    }
    for (let i in prop) {
        if (!(i in obj) || merge) {
            obj[i] = prop[i];
        }
    }
    return obj;
};

/**
 * Execute a balafon CLI command safely using execFile (no shell injection).
 * @param {string[]} args - CLI arguments as an array (NOT a shell string)
 * @param {object} [option] - plugin option supplying controller / cwdir
 * @param {number} [timeoutMs=15000] - abort timeout in milliseconds
 * @returns {Promise<string|null>}
 */
const exec_cmd = async function (args, option, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const { controller, cwdir } = option || __baseOptions;
        const r = [...args];
        if (controller) {
            r.push('--controller:' + controller);
        }
        if (cwdir) {
            r.push('--wdir:' + cwdir);
        }
        execFile('balafon', r, { timeout: timeoutMs }, (err, stdout, stderr) => {
            if (!err) return resolve(stdout);
            return reject(new Error(`[${__PLUGIN_NAME__}] ${stderr || err.message}`));
        });
    }).catch((e) => {
        console.log("[" + __PLUGIN_NAME__ + "] - error - ", e.message, "\n");
        return null;
    });
};

/**
 * @param {*} option
 * @param {*} _ctx shared plugin context
 */
const watchForProjectFolder = (option, _ctx) => {
    const { g_watchFile, g_watchListener, g_components, __ids } = _ctx;
    return {
        configureServer(server) {
            g_watchFile.server = server;
            g_watchListener.server = server;
            const { cwdir } = option;
            if (cwdir) {
                server.watcher.add(cwdir);
                server.watcher.on('change', async (file) => {
                    file = normalizePath(file);
                    const mod_graph = server.moduleGraph;
                    if (g_watchListener.handle(file, { type: 'change', server })) {
                        return;
                    }

                    if (/\.(vue)$/.test(file)) {
                        // external module definition
                        const v_mod =
                            ((s) => s ? mod_graph.getModuleById(s) : null)(g_watchFile.getId(file))

                        if (v_mod) {
                            // + | invalidate the module so it can be reloaded via the F5
                            mod_graph.invalidateModule(v_mod);

                            let _id = v_mod.id.replace("\0", '');
                            let _path = '/@id/__x00__' + _id;
                            // delete the previous component id
                            delete (g_components[_id]);
                            // + | load manually file so it can be loaded when updated on F5
                            // + | passing id without \0 to let plugin detect vue file
                            await _loadVueFile(file, g_components, g_watchFile._p_vue_plugin, _id);

                            // + | send request to do HMR
                            await server.ws.send({
                                type: 'update',
                                updates: [
                                    {
                                        type: 'js-update',
                                        path: _path,
                                        acceptedPath: _path,
                                        timestamp: Date.now(),
                                        explicitImportRequired: false,
                                        isWithinCircularImport: false,
                                        ssrInvalidates: []
                                    }
                                ]
                            });
                            await server.ws.send({
                                type: 'update',
                                updates: [
                                    {
                                        type: 'css-update',
                                        path: './assets/css/main.css',
                                        acceptedPath: './assets/css/main.css',
                                        timestamp: Date.now(),
                                        explicitImportRequired: false,
                                        isWithinCircularImport: false,
                                        ssrInvalidates: []
                                    }
                                ]
                            });
                            return;
                        }
                    }
                    else if (/\/Data\/config\.xml$/.test(file)) {
                        server.restart();
                    } else if (/\.(phtml|pcss|bview|php|css|xml)$/.test(file)) {
                        // + | invalidate styling virtual module
                        const { idxs } = __ids;
                        if (!idxs || (Object.keys(idxs).length == 0)) {
                            const module = mod_graph.getModuleById("\0virtual:balafon-corecss");
                            if (module) {
                                mod_graph.invalidateModule(module);
                            }
                        } else {
                            let mod_invalidated = false;
                            for (let i in idxs) {
                                const module = mod_graph.getModuleById(i);
                                if (module) {
                                    mod_graph.invalidateModule(module);
                                    mod_invalidated = true;
                                }
                            }
                            if (mod_invalidated) {
                                return;
                            }
                        }
                        console.log(`[blf] - ${file} changed`);
                        server.ws.send({
                            type: 'full-reload' // update
                        });
                    }
                });
            }
        }
    };
};

/**
 * @param {*} plugin Vue plugin instance (must be non-null)
 * @param {string} code source to transform
 * @param {string} id virtual module id
 */
async function _helper_transform(plugin, code, id) {
    if (!plugin) {
        throw new Error(`[${__PLUGIN_NAME__}] Vue plugin not found for transform of: ${id}`);
    }
    if (typeof plugin.transform == 'function')
        return await plugin.transform(code, id);
    return await plugin.transform.handler(code, id);
}

const removeIndexHtml = (option) => {
    /**
     * @var {}
     */
    const _ref = {};
    return {
        name: 'balafon:rm-index',
        enforce: 'post',
        apply: 'build',
        configResolved(option) {
            _ref.outDir = path.resolve(option.root, option.build.outDir);
        },
        transformIndexHtml(_r, ctx) {
            _ref.path = ctx.path;
        },
        closeBundle() {
            if (option.leaveIndexHtml) {
                return;
            }
            let l = [_ref.outDir, _ref.path].join('');
            const p = path.resolve(__dirname, l);
            if (_ref.path && fs.existsSync(p)) {
                console.log('removing ... ' + cli.green('index.html'));
                fs.unlinkSync(p);
            }
        }
    }
};

/**
 * view only environment definition
 * @param {*} option
 * @returns
 */
const viewControllerDefinition = (option) => {
    const { controller } = option;
    if (controller) {
        return {
            name: "balafon:view-controller-env-definition",
            enforce: 'post',
            apply: 'build',
            async closeBundle() {
                let src = await exec_cmd(['--env'], option);
                console.log(src);
            }
        }
    } else {
        return null;
    }
}

/**
 * resolving virtual reference
 * @param {*} option
 * @param {*} _ctx shared plugin context
 * @returns
 */
const virtualReferenceHandler = (option, _ctx) => {
    const { g_components, chunk_await_to, __app_environment, __ids, g_watchFile, g_watchListener } = _ctx;
    const _id_i18n = 'balafon-i18n';

    let _container = null, v_option = null;
    const _vue_ = _createVueFinder();

    const to_asset_code = function (q, name, source, { ref }) {
        let p = chunkPrefix(option);
        name = path.join(p, name);
        let js = q.emitFile({
            type: 'asset',
            name,
            source
        });
        arguments[3].ref = js;
        js = _rollup_uri(js);
        let code = `export default (()=>import(${js}))()`;
        return { code, map: null };
    };
    const entries = [];
    const __COMPONENT_PREFIX__ = 'balafon-ssr-component/';
    let _server;
    const v_modules = {
        'core.js': function () {
            return entries['core.js'];
        },
        'core.css.js': function () {
            return entries['core.css.js'];
        },
        'virtual:balafon-i18n': async function () {
            const { controller, useI18n } = option;
            let { i18n, useCore } = option;
            let lang = null, code = null, templatejs = null;
            if (!i18n) {
                if (typeof (useI18n) == 'object') {
                    i18n = useI18n.dir;
                    ({ lang } = useI18n);
                }
            }
            i18n = i18n || 'src/i18n';
            lang = lang || 'en';
            let location = path.resolve(__dirname, i18n);
            let locale = {};
            let v_fc_checkLocale = (r) => {
                if (r in locale) throw Error('locale ' + r + ' already defined');
            };
            const cmd = ['--vite:i18n'];
            if (useCore) {
                cmd.push('--use-core');
            }
            if (lang) {
                cmd.push('--lang:' + lang);
            }
            cmd.push('--app-i18n:' + location);
            let r = await exec_cmd(cmd, option);
            if (!r) {
                return null;
            }
            templatejs = fs.readFileSync(_fs_exports('/i18n.js.template'), 'utf-8');
            templatejs = templatejs.replaceAll('%lang%', r.trim().length > 0 ? r : '');
            if (is_prod) {
                // file for productions .
                let ref = this.emitFile({
                    type: 'chunk',
                    id: _id_i18n,
                    name: 'balafon/core-lang',
                    preserveSignature: 'strict'
                });

                // import all json data then
                let js_res = [];
                let q = this;
                js_res.push('const res={');
                let ch = '';
                fs.readdirSync(location, { recursive: true }).forEach((o, t, m) => {
                    if (m = /(?<locale>[a-zA-Z\-]+)\.(?<t>\bjson\b)$/.exec(o)) {
                        let l = m.groups['locale'];
                        let ref = q.emitFile({
                            type: 'prebuilt-chunk',
                            fileName: 'js/' + chunkPrefix(option) + '/lang/i18n/' + l + '.js',
                            code: 'export default ' + (fs.readFileSync(path.join(location, o), 'utf-8') || '{}')
                        });

                        js_res.push(ch + _identifier(l) + ':(async()=>await import(' + _rollup_uri(ref) + '))()');
                        ch = ',';
                        chunk_await_to[ref] = new BalafonEmitRegex(ref,
                            "\\(async\\(\\)=>await\\s+import\\(\\s*new\\s+URL\\(\"[filename]\",import\\.meta\\.url\\)\\.href\\)\\)\\(\\)",
                            "(await $&).default"
                        );
                    }
                });
                js_res.push('}');

                entries['balafon/chunk-res'] = js_res.join("\n") + '; const { fr, en, nl}=res; export { res as default, fr, en , nl }';
                js_res.length = 0;
                js_res.push('import res, { fr, en , nl } from "balafon/chunk-res";')

                templatejs = js_res.join("\n") + templatejs.replaceAll('%locale%', 'res');
                entries[_id_i18n] = templatejs;
                chunk_await_to[ref] = new BalafonEmitRegex(ref,
                    '\\(async\\s*\\(\\s*\\)\\s*=>\\s*await\\s+import\\(new\\s+URL\\("[filename]"',
                    'await $&');
                code = ['const m = (async()=>await import(' + _rollup_uri(ref) + '))();',
                    'const d = m.default; const {lang}=m; export { d as default, lang }'].join("\n");
                return {
                    code
                };
            }


            if (!('i18n' in g_watchListener.registry)) {
                const { server } = g_watchListener;
                server.watcher.add(location);
                g_watchListener.register((js) => {
                    let l = new RegExp("^" + location + "\/.+\.json");
                    if (l.test(js)) {
                        console.log(cli.magenta('[' + this._plugin.name + ']') + ' - language changed');
                        let mod = server.moduleGraph;
                        let fmod = mod.getModuleById("\0virtual:balafon-i18n");
                        if (fmod) {
                            mod.invalidateModule(fmod);
                            server
                                .ws.send({
                                    type: 'full-reload' // update
                                });
                        }
                        return true;
                    }
                });
                g_watchListener.registry['i18n'] = 1;
            }
            fs.readdirSync(location, { recursive: true }).forEach((o, t, m) => {
                if (m = /(?<locale>[a-zA-Z\-]+)\.(?<t>\bjson\b)$/.exec(o)) {
                    let l = m.groups['locale'];
                    let t = m.groups['t'];
                    v_fc_checkLocale(l);
                    let code = fs.readFileSync(path.join(location, o), 'utf-8') || '{}';
                    locale[l] = t == 'json' ? JSON.parse(code) : (new Function("defineI18n", code)).apply(null, [defineI18n]);
                }
            });

            templatejs = templatejs.replaceAll('%locale%', JSON.stringify(locale));
            return {
                'code': templatejs
            };
        },
        'virtual:balafon-corejs': async function () {
            // + | ------------------------------------------------------------------------
            // + | inject balafon corejs
            // + |
            let src = "";
            const is_ssr = v_option.build.ssr !== false;
            // ingore core-js import use to skip vite to analyse it
            if (is_ssr) {
                src = "export default null; ";
            } else {
                src = await exec_cmd(['--js:dist'], option);
                src = src.replace(/\bimport\b\s*\(/g, "import(/* @vite-ignore */");
            }
            if (is_prod) {
                const _id = 'core.js';
                if (!option.buildCoreJSAsAsset) {
                    // + | emit as chunk
                    let tref = this.emitFile({
                        type: 'chunk',
                        id: _id,
                        name: chunkPrefix(option) + '/core',
                        preserveSignature: 'strict'
                    });
                    entries[_id] = src;
                    return 'export default (()=>import(' + _rollup_uri(tref) + '))()';
                }
                let ref = { ref: null }
                return to_asset_code(this, _id, src, ref);
            }
            let _result = [
                'export default (()=>{ ',
                'try{',
                src,
                ' } catch(e){ console.log("[core-js]: ", e); };',
                ' return globalThis.igk; })()'
            ].join('');
            return _result;
        },
        'virtual:balafon-corecss': async function () {
            // + | ------------------------------------------------------------------------
            // + | inject core style
            // + |
            const { controller } = option;
            const is_ssr = v_option.build.ssr !== false;
            if (is_prod) {
                if (is_ssr) {
                    // disable calculation of corecss
                    return 'export default null';
                }
            }
            let cmd = controller ? ['--project:css-dist', controller] : ['--css:dist'];
            cmd.push('--set-env:IGK_VITE_APP=1');
            let src = await exec_cmd(cmd, option);
            src = btoa(src);
            let j = `const _oc = atob("` + src + `"); export default (()=>{ if (typeof(document)=='undefined') return null; let l = document.createElement("style"); document.body.appendChild(l); l.append(_oc); return l;})();`;
            if (is_prod) {
                if (!option.buildCoreJSAsAsset) {
                    const _id = 'core.css.js';
                    let p = chunkPrefix(option);
                    // emit as chunk
                    let tref = this.emitFile({
                        'type': 'chunk',
                        'id': _id,
                        'name': p + '/core.css'
                    });
                    entries[_id] = j;
                    return 'export default (()=>import(' + _rollup_uri(tref) + '))()';
                }
                let ref = { ref: null };
                return to_asset_code(this, '/core.css.js', j, ref);
            }
            return j;
        },
        'virtual:balafon-project-settings': async function () {
            const { defaultUser } = option;
            const cmd = ['--vite:project-settings'];
            if (defaultUser) {
                cmd.push('--user:' + defaultUser);
            }
            let src = await exec_cmd(cmd, option);
            if (!src || src.length == 0)
                src = "{}";
            return {
                code: `export default ${src}`
            }
        },
        'virtual:balafon-utility': async function () {
            let { target } = _ctx._config_option;
            return `const _data = ${JSON.stringify(({ target }))}; const initVueApp= (app)=>{app.mount(_data.target|| '#app'); return app;}; export { initVueApp };`;
        },
        'virtual:balafon-vite-app': async function () {
            let { useRoute, usePiniaStore, useI18n } = _ctx._config_option;
            let _file = fs.readFileSync(_fs_exports('/app.js.template'), 'utf-8');
            const header = [];
            const uses = [];
            if (useRoute) {
                header.push("import routes from '@/route'");
                uses.push('routes && app.use(routes);');
            }
            if (usePiniaStore) {
                header.push("import store from '@/store'");
                uses.push("store && app.use(store);");
            }
            if (useI18n) {
                header.push("import i18n from '@/i18n'");
                uses.push("i18n && app.use(i18n);");
            }
            (header.length > 0) && header.push('');

            // + |  treat code file
            _file = _file.replace('%target%', option.target ? '"' + option.target + '"' : 'null');
            (uses.length > 0) && uses.push('');
            _file = _file.replace('%header-extra-import%', header.join('\n'));
            _file = _file.replace('%plugin-use%', uses.join('\n'));

            return {
                'code': _file
            }
        },
        'virtual:balafon-route': async function () {
            const { controller, app_name } = _ctx._config_option;
            let src = [
                "const webBasePath = '" + __app_environment.entryuri + "';",
                (await exec_cmd(
                    ['--vite:route', controller, ...(app_name ? [app_name] : [])],
                    _ctx._config_option
                )) + " ",
                "export {webBasePath, routes}"
            ].join("\n");
            return src;
        },
        'virtual:balafon-iconslib': async function () {
            // + | ------------------------------------------------------------------------
            // + | include iconlib template
            // + |

            let _file = fs.readFileSync(_fs_exports('/iconlib.vue.template'), 'utf-8');
            let _plugins = _vue_(v_option.plugins);
            let _result = null;
            // + |  treat code file
            _file = _file.replaceAll('%default_lib%', option.icons['\0default_lib'] ?? 'ionicons')
            if (_plugins) {
                _result = await _helper_transform(_plugins, _file, 'virtual:balafon-iconslib.vue');
            }
            if (!_result) {
                _file = this.transform ? this.transform(_file) : _file;
            }
            return _result || {
                'code': _file,
                'map': null,
            }
        },
        'virtual:balafon-logo': async () => {
            // + | ------------------------------------------------------------------------
            // + |  balafon project logo
            // + |
            const { controller, logo } = option;
            let g = null;
            let _lf = logo ? path.resolve(__dirname, logo) : null
            if (_lf && fs.existsSync(_lf)) {
                g = fs.readFileSync(_lf, 'utf-8');
            } else {
                if (!controller) {
                    return 'import * as Vue from "vue"; const {h} = Vue; export default {render(){return h("div", "logo")}}';
                }
                g = await exec_cmd(['--project:info', controller, '--logo'], option);
            }
            let code = null;
            let _p_vue_plugin = _vue_(v_option.plugins);
            if (g && _p_vue_plugin) {
                // + | transform svg content to template using vue:plugin transform
                g = g.substring(g.indexOf("<svg"))
                g = '<template><span class="logo">' + g + '</span></template>';
                code = await _helper_transform(_p_vue_plugin, g, 'virtual:balafon-logo.vue');
                return code;
            }
        },
        'virtual:balafon-ssr-components': async function () {
            // + | ------------------------------------------------------------------------
            // + | SERVING BALAFON SHARED SSR-COMPONENTS
            // + |

            const { controller } = _ctx._config_option;
            let tp = this;
            let src = (await exec_cmd(['--vite:components', controller], _ctx._config_option) + '').trim();
            let _p_vue_plugin = _vue_(v_option.plugins);
            g_watchFile._p_vue_plugin = _p_vue_plugin;
            let lrc = [];
            if (src.length > 0) {
                let m = JSON.parse(src);
                let l = '$files';
                if (l in m) {
                    // load and transform files - to chunk data
                    let fc = async function (j, i) {
                        for (i in j) {
                            let file = j[i];
                            const _id = __COMPONENT_PREFIX__ + i;
                            if (is_prod) {
                                let r = this.emitFile({
                                    type: 'chunk',
                                    id: _id,
                                    name: _getSrvComponents(option) + i,
                                    preserveSignature: 'strict' // force loading with string definition
                                });
                                lrc[i] = '()=>import(' + _rollup_uri(r) + ')';
                                await _loadVueFile(file, g_components, _p_vue_plugin, _id);
                            } else {
                                await _loadVueFile(file, g_components, _p_vue_plugin, _id);
                                const { moduleGraph } = _server;
                                moduleGraph.getModuleById(file) || await (async (p, l) => {
                                    /**
                                     * @type { import('vite').ModuleGraph }
                                     */
                                    l = moduleGraph.createFileOnlyEntry(file);
                                    if (l) {
                                        // fix: selfAccepting error Dec 2024
                                        // l.isSelfAccepting = true;
                                        moduleGraph.idToModuleMap.set(file, l);
                                        moduleGraph.urlToModuleMap.set(file, l);
                                        p = l;
                                    }
                                    return p;
                                })()
                                g_watchFile.store(_id, file);
                                let id = i;
                                let is_async = false;
                                if (id.indexOf('-')) {
                                    id = `"${i}"`;
                                }
                                is_async = /^Async/.test(i.split('-').pop())
                                let v_v = id + ': ';
                                v_v += (is_async) ? 'defineAsyncComponent(async()=>await import("' + __COMPONENT_PREFIX__ + i + '"))' :
                                    'defineComponent((await (async ()=>await import("' + __COMPONENT_PREFIX__ + i + '") )()).default)';
                                lrc.push(v_v);
                            }
                        }
                    };
                    await fc.apply(tp, [m[l]]);
                }
                if (is_prod) {
                    let lsrc = [];
                    ((i) => { for (i in lrc) { lsrc.push(_identifier(i) + ':' + lrc[i]); } })()
                    lsrc = lsrc.join(',');
                    return 'const d ={' + lsrc + '}; export { d as default} ';
                }
                let lsrc = '{' + lrc.join(',') + '}';
                return 'import * as Vue from \'vue\'; const {h, defineComponent, defineAsyncComponent} = Vue; const c = ' + lsrc + '; export {c as default}';
            }



            // if (src.length>0){
            //     let n = {};
            //     let df = [];
            //     let idx = 0; // to retrieve id of the component
            //     let def = [];
            //     const pluginTransform = async function(r){
            //         // console.log('transforming....', r);
            //         let tsrc = fs.readFileSync(r, 'utf8');
            //         let f =  basename(r);
            //         df[r] = await _p_vue_plugin.transform(tsrc, f);
            //         return r;
            //     }, defineComponent = (l)=>{
            //         console.log('log', l);
            //         def[idx] = { args: l, func:new Function('defineComponent(l)'), invoke(){
            //
            //         });
            //         return idx++;
            //     }, defineAsyncComponent = (l)=>{
            //         def[idx] = l;
            //         console.log('async', l);
            //         return idx++;
            //     }, resolve=(q,i,j)=>{
            //         for(i in q){
            //             j = q[i];
            //             if (typeof(j) == 'number'){
            //                 q[i] = def[j];
            //             }else{
            //                 q[i] = df[j];
            //             }
            //         }
            //     }; // obtain async function constructor
            //     const AsyncFunction = async function () {}.constructor;
            //
            //     let fc = new AsyncFunction('pluginTransform','defineComponent', 'return '+src+';');
            //     let g = await fc.apply(n,[pluginTransform, defineComponent]);
            //     // merging list
            //     let tl = resolve(g);
            //     // fc =  new Function('src', 'g', 'df','resolve', 'return {...(JSON.parse(src)),...resolve(JSON.parse(g))}');
            //     // let m = fc.apply(null, [src, g, df, resolve]);
            //
            //
            //     return 'import * as Vue from \'vue\'; const {h, defineComponent, defineAsyncComponent} = Vue; const c = '+src+'; export {c as default}';
            // }
            return 'const c = null; export {c as default}';
        }
    };
    v_modules[_id_i18n] = function () {
        return entries[_id_i18n];
    };
    const v_idxs = {};
    __ids.idxs = v_idxs;

    return {
        name: "balafon:virtual-reference",
        configResolved(option) {
            v_option = option;
        },
        configureServer(server) {
            _server = server;
        },
        /**
         * resolve virtual keys
         * @param {*} id
         * @returns
         */
        resolveId(id) {
            // resolve virtual reference
            const idx = id in v_modules;
            if (idx) {
                let v_idx = '\0' + id;
                v_idxs[v_idx] = id;
                return v_idx;
            }
            if (id in g_components) {
                return '\0' + id;
            }
            if (/^lang\/i18n\//.test(id)) {
                return '\0' + id;
            }
            if (id in entries) {
                return id;
            }
        },
        /**
         * @param {*} id
         */
        async load(id) {
            if (id in v_idxs) {
                let v_name = v_idxs[id];
                let fc = v_modules[v_name];
                return fc.apply(this, [option]);
            }
            let rgp = new RegExp("^\0" + __COMPONENT_PREFIX__);
            if (rgp.test(id)) {
                id = id.replace("\0", '');
                let rep = g_components[id];
                return rep;
            }
            id = id.replace("\0", '');
            if (id in entries) {
                return entries[id];
            }
        }
    }
};

/**
 * @param {*} option
 * @returns
 */
const addFavicon = (option) => {
    const _ref = {};
    return {
        name: "balafon:favicon-missing",
        configResolved(option) {
            _ref.outDir = path.resolve(option.root, option.build.outDir);
        },
        async closeBundle() {
            let tpath = path.resolve(_ref.outDir, 'favicon.ico');
            if (!fs.existsSync(tpath)) {
                // + | get create a favicon
                const src = await exec_cmd(['--favicon', '--type:png'], option)
                const ts = src.split(',');
                const r = ts.splice(1).join(',');
                const data = atob(r);
                const dir_name = path.dirname(tpath);
                if (!fs.existsSync(dir_name)) {
                    fs.mkdirSync(dir_name, { recursive: true });
                }
                // + | must use binary format to write data to file
                fs.writeFileSync(tpath, data, 'binary');

            }
        }
    }
};

/**
 * inject controller project environment arg
 * @param {*} option
 * @param {*} _ctx shared plugin context
 * @returns
 */
const initEnv = (option, _ctx) => {
    const { __app_environment } = _ctx;
    return {
        async config(conf) {
            await init_env(option, __app_environment);
            const { controller } = option;
            let { cwdir } = option;
            if (controller && !cwdir) {
                let info = await exec_cmd(['--project:info', controller, '--base-dir'], option);
                if (info) {
                    cwdir = info.trim();
                    option.cwdir = cwdir;
                }
            }
            const list = {};
            const wdd_env = loadEnv(mode, path.resolve(__dirname));

            for (let j in wdd_env) {
                list[j] = JSON.stringify(wdd_env[j]);
            }

            if (cwdir && controller) {

                const env = loadEnv(mode, cwdir);
                env.VITE_IGK_CONTROLLER = controller;
                env.VITE_IGK_ENTRY_URL = env['VITE_URL'] + __app_environment.entryuri;

                // transform to definition sample
                for (let j in env) {
                    list[j] = JSON.stringify(env[j]);
                }
                conf.base = __app_environment.entryuri;
                conf.resolve.alias['@core-views'] = cwdir + "/Views";
            }
            conf.define = merge_properties(conf.define, {
                ...list
            }, true);
        }
    };
}

const postInitEnv = (option) => {
    return {
        name: 'balafon:post-init-env',
        enforce: 'post',
        target: 'build',
        config(conf) {
            if (!('build' in conf)) {
                return {};
            }
            return {
                ...conf, ...{
                    build: {
                        rollupOptions: {
                            output: {
                                manualChunks: ((chunk) => {
                                    return (n) => {
                                        /* @balafon-vite-plugin:manualchunks */
                                        if (/^\0balafon-ssr-component/.test(n)) {
                                            // + |
                                            return 'balafon/srv-components-lib';
                                        }
                                        if (chunk) {
                                            if (typeof (chunk) == 'function') {
                                                return chunk.apply(this, [n]);
                                            }
                                            return chunk;
                                        }
                                    }
                                })(conf.build?.rollupOptions?.output?.manualChunks),
                                assetFileNames: ((chunk) => {
                                    return function (n) {
                                        if (/\.(jp(e)?g|png|ico|bmp|svg|tiff)$/.test(n.originalFileName))
                                            return "img/[ext]/[name].[ext]";
                                        if (typeof (chunk) == 'function') {
                                            return chunk.apply(this, [n]);
                                        }
                                        if (typeof chunk > 'u') {
                                            return n.name;
                                        }
                                        return chunk;
                                    }
                                })(conf.build?.rollupOptions?.output?.assetFileNames)

                            }
                        }
                    }
                }
            };

        }
    }
}

/**
 * @param {*} option
 * @param {*} _ctx shared plugin context
 * @returns
 */
const balafonIconLib = (option, _ctx) => {
    const { chunk_await_to } = _ctx;
    const { icons } = option;
    // +| retrieve command args array
    const _get_cmd = function (cacheddata) {
        let lib = [];
        for (let i in icons) {
            if (i.startsWith('\0')) continue;
            let s = '';
            let l = icons[i];
            s += i + ',';
            if (cacheddata && Array.isArray(l)) {

                let p = cacheddata[i];
                if (p) {
                    const tl = l[1].split(',');

                    p.forEach(s => {
                        if (tl.indexOf(s) == -1) {
                            tl.push(s);
                        }
                    })
                    l[1] = tl.join(',');
                }


            }
            s += l.join('\\;');
            lib.push('--library:' + s);
        }
        return lib.length > 0 ? lib : null;
    };
    const ref_emits = [];
    let top_conf = null;

    const entries = [];
    /** @type{import('vite').Plugin}*/
    return {
        name: 'balafon:libicons',
        resolveId(id) {
            if (id == 'virtual:balafon-libicons') {
                return "\0" + id;
            }
            if (id == 'svg-lib.js') {
                return "\0" + id;
            }
        },
        configResolved(conf) {
            top_conf = conf;
        },
        async load(id, p) {
            if (id == "\0virtual:balafon-libicons") {
                const is_ssr = top_conf.build.ssr !== false;
                if (is_prod) {
                    const data = ((f) => {
                        if (fs.existsSync(f)) {
                            return JSON.parse(fs.readFileSync(f, 'utf-8'));
                        }
                    })(top_conf.cacheDir + '/.balafon/icons.lib.json');
                    const cmdArgs = _get_cmd(data);
                    // + | emit only work on production -
                    let src = await exec_cmd(
                        ['--vue3:convert-svg-to-js-lib', ...(cmdArgs || [])],
                        option
                    );

                    if (is_ssr) {
                        // direct export
                        return ['import * as Vue from \'vue\'; ', src].join("\n");
                    }

                    if (!option.buildIconLibAsAsset) {
                        // + | emit as chunk
                        if (src?.trim().length > 0) {
                            const _id = 'svg-lib.js'
                            let tref = this.emitFile({
                                type: 'chunk',
                                id: _id,
                                name: chunkPrefix(option) + '/svg-lib',
                                // + | preserve the declaration signature
                                preserveSignature: 'strict'
                            });
                            entries[_id] = src;
                            ref_emits.push(tref);
                            return 'export default (()=> import(' + _rollup_uri(tref) + '))()';
                        } else {
                            return 'const d = null; export { d as default}';
                        }
                    }
                    let ref1 = this.emitFile({
                        type: 'asset',
                        name: 'svg-lib.js',
                        source: src,
                    })
                    ref_emits.push(ref1);
                    ref1 = _rollup_uri(ref1);
                    let code = `export default (()=>import(${ref1}))()`;
                    return { code, map: null }
                }
                return { code: 'export default null;', map: null }
            }
            if (id == '\0svg-lib.js') {
                return entries['svg-lib.js'];
            }
        },
        generateBundle(option, bundle) {
            let m = [];
            let q = this;
            let v_fc = (o) => {
                if (o instanceof BalafonEmitRegex) {
                    m.push(o);
                    return;
                }

                let n = this.getFileName(o);
                n = n.replace(".", "\\.");
                m.push(new RegExp(
                    '(import\\(new URL\\("' + n + '",import\\.meta\\.url\\)\\.href\\))', 'g'
                ));
            };
            ref_emits.forEach(v_fc);
            for (let i in chunk_await_to) {
                v_fc(chunk_await_to[i]);
            }


            if (option.format == 'es') {
                for (let i in bundle) {
                    const file = bundle[i];
                    if (i.endsWith('.js') && (file.type == 'chunk')) {
                        let code = file.code;
                        if (code) {
                            m.forEach(function (n) {
                                if (n instanceof BalafonEmitRegex) {
                                    let regex = n.regex(q, file.fileName);
                                    if (regex.test(code)) // to check that regex is in content to chunk module
                                        code = code.replace(regex, n.replace);
                                } else
                                    code = code.replace(n, '(await $1).default');
                            });
                            file.code = code;
                        }
                    }
                }
            }
        }
    };
};

/**
 * icons library — serve-only, per-icon lazy loader with cache
 * @param {*} option
 * @returns
 */
const balafonIconLibraryAccess = (option) => {
    const store = {};
    let v_option = null;
    const _vue_ = _createVueFinder();
    return {
        name: "balafon:libicons-library-access",
        apply: "serve",
        configResolved(option) {
            v_option = option;
        },
        /**
         * @param {string} id
         * @returns
         */
        async resolveId(id) {
            if (id.startsWith('balafon-icons/')) {
                return '\0' + id;
            } else if (id.startsWith('@id/\0balafon-icons/')) {
                // relative access
                return '\0' + id.replace('@id/\0balafon-icons', 'balafon-icons/');
            }
        },
        async load(id) {
            if (id.startsWith('\0balafon-icons/')) {
                const p = id.split('/').slice(1);
                const lib = p[0];
                const name = p[1];
                const key = [lib, name].join('-');
                if (key in store) {
                    console.log("from stored");
                    return store[key];
                }
                const location = option.icons[lib];
                const _vue_file = path.join(location[0], name + ".vue");
                let src = '';
                if (fs.existsSync(_vue_file)) {
                    /**
                     * load .vue with manual edition
                     */
                    let _plugins = _vue_(v_option.plugins);
                    if (_plugins) {
                        src = _plugins.transform(fs.readFileSync(_vue_file, 'utf-8'), _vue_file);
                    } else {
                        throw new Error('missing plugins');
                    }
                } else {
                    src = await exec_cmd(
                        ['--vue3:convert-svg-to-js-lib', '--single',
                            '--library:' + lib + ',' + location[0] + "\\;" + name],
                        option
                    );
                }
                store[key] = src;
                const _store = store['\0definition'] ?? {};
                if (!(lib in _store)) {
                    _store[lib] = [];
                }
                _store[lib].push(name);
                store['\0definition'] = _store;
                let pp = path.join(this._container.config.cacheDir, '.balafon');
                fs.mkdirSync(pp, { recursive: true });
                fs.writeFileSync(path.join(pp, 'icons.lib.json'), JSON.stringify(store['\0definition']), 'utf-8');
                return src;
            }
        }
    }
}

/**
 * balafon ssr loading
 * @param {*} option
 * @returns
 */
const balafonSSRLoading = (option) => {
    let _conf = null;
    const _tfile = {};
    return {
        "name": "balafon/ssr-loading",
        'apply': "build",
        "enforce": "post",
        configResolved(conf) {
            _conf = conf;
        },
        async closeBundle(s, m, isWrite) {
            let ssr = _conf.build.ssr;
            if (typeof (ssr) == 'string') {
                // + | ---------------------------------------------------
                // + | for single file entry just retrieve the server data
                // + |
                const _out_dir = _conf.build.outDir;
                const _is_absolute = path.isAbsolute(_out_dir);

                let _path = path.resolve(_out_dir, ssr);

                let _tspath = path.resolve(_out_dir, 'entry-server.render.js');
                let r = null;
                let _unlinks = [_tspath];
                if (_is_absolute) {
                    const _cwd = process.env.PWD;
                    const is_sub_dir = _out_dir.startsWith(_cwd);

                    if (!is_sub_dir) {
                        // + | ----------------------------------------
                        //create a sym link to json package
                        let rr = path.join(_out_dir, 'package.json');
                        let rm = path.join(_cwd, 'package.json');
                        if (!fs.existsSync(rr))
                            fs.symlinkSync(rm, rr, 'file');
                        _unlinks.push(rr);
                        rr = path.join(_out_dir, 'node_modules');
                        if (!fs.existsSync(rr))
                            fs.symlinkSync(path.join(_cwd, 'node_modules'), rr, 'dir');
                        _unlinks.push(rr);
                    }
                }

            } else {
                let input = _conf.build.input
            }
        },
        async buildStart(context) {
            if (_conf.build.ssr) {
                // + | emit prebuilt chunk to generate ssr render
                _tfile['ssr-render.js'] = this.emitFile({
                    type: 'prebuilt-chunk',
                    fileName: 'ssr-render.js',
                    code: [
                        " import * as f from './entry-server.js'",
                        " let m = await f.render();",
                        " console.log(m.html)"
                    ].join("\n")
                });
            }
        }
    }
};

/**
 * handle project balafon component
 * @param {*} option
 * @returns
 */
const balafonSSRComponent = (option) => {
    let _conf = null;
    let { componentUri } = option;
    if (!componentUri) {
        return;
    }
    const { controller } = option;
    return {
        name: 'balafon:src-component',
        enforce: 'post',
        target: 'build',
        configResolved(conf) {
            _conf = conf;
            let chunkSrc = _conf.build.rollupOptions.output.chunkFileNames
            _conf.build.rollupOptions.output.chunkFileNames = (chunkInfo, r) => {
                if (is_prod || (_conf.build.ssr !== false)) {
                    const rgex = /^\0virtual:balafon-components\//;
                    if (rgex.test(chunkInfo.facadeModuleId)) {
                        let s = chunkInfo.facadeModuleId.replace(rgex, '');
                        chunkInfo.name = s;
                        return 'js/ssr-' + s + '.js';
                    }
                }
                return typeof (chunkSrc) == 'function' ?
                    chunkSrc.apply(this, [chunkInfo]) :
                    chunkSrc;
            }
            const srv = '@server';
            if (!(srv in _conf.resolve.alias)) {
                _conf.resolve.alias[srv] = "";
            }
        },
        async load(id) {
            if (is_prod || (_conf.build.ssr !== false)) {
                const gex = /^\0virtual:balafon-components\//;
                if (gex.test(id)) {
                    id = id.replace(gex, '');
                    // for controller
                    if (controller) {

                    }
                    let r = await exec_cmd(
                        ['--request:curl', componentUri + '/' + id + '?mode=production&target=ssr'],
                        option
                    );
                    return r;
                }
            }
        },
        resolveId(id) {
            if (is_prod || (_conf.build.ssr !== false)) {
                if (/^virtual:balafon-components\//.test(id)) {
                    return "\0" + id;
                }
            }
        },
        transform(src, id) {
            if (is_prod || (_conf.build.ssr !== false)) {
                if (/\.vue$/.test(id)) {
                    src = src.replace(/('|")@server\/components\//g, '$1virtual:balafon-components/components/')
                    return src;
                }
            }
        }
    }
};

/**
 * in global configuration
 */
const globalInitialize = (option, _ctx) => {
    return {
        name: 'vite-plugin:balafon-global-init',
        configResolved(conf) {
            _ctx._globalConf = conf;
        }
    }
};

// All named exports placed after their definitions — avoids ReferenceError
export {
    removeIndexHtml,
    addFavicon,
    virtualReferenceHandler,
    viewControllerDefinition,
    initEnv,
    postInitEnv,
    balafonSSRLoading,
    balafonIconLibraryAccess,
    balafonIconLib,
    balafonSSRComponent
}

/**
 * Main plugin factory
 * @param {object} option plugin configuration
 * @returns {Promise<import('vite').Plugin[]>}
 */
export default async (option) => {
    console.log(cli.blueBright('igkdev') + ' - plugin start : ' + cli.green(__PLUGIN_NAME__))
    option = merge_properties(option, __baseOptions);

    if (!option.icons) {
        option.icons = {};
    }

    // Isolated per-invocation state — no module-level mutable globals
    const _ctx = {
        _globalConf: null,
        g_components: {},
        chunk_await_to: {},
        __app_environment: { _init: false },
        __ids: {},
        _config_option: {},
        g_watchFile: _createWatchFile(),
        g_watchListener: _createWatchListener(),
    };
    merge_properties(_ctx._config_option, option);

    return [
        globalInitialize(option, _ctx),
        initEnv(option, _ctx),
        postInitEnv(option),
        removeIndexHtml(option),
        addFavicon(option),
        virtualReferenceHandler(option, _ctx),
        watchForProjectFolder(option, _ctx),
        balafonSSRLoading(option),
        balafonIconLibraryAccess(option),
        balafonIconLib(option, _ctx),
        balafonSSRComponent(option)
    ];
}
