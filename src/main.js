import path from 'path'
import fs from 'fs'
import cli from 'cli-color'
import { exec } from 'child_process';
import { normalizePath, loadEnv } from 'vite';
import { fileURLToPath } from 'url';

/**
 * in global configuration 
 */
let _globalConf = null;
const __PLUGIN_NAME__ = 'vite-plugin-balafon'
const __dirname = process.env.PWD; 
const __baseOptions = {
    controller: null,
    cwdir: null,
    leaveIndexHtml: false,
    defaultUser: null,
    target: '#app'
};
const _config_option = {};
const __ids = {};
const __app_environment = { _init: false };
const mode = process.env.NODE_ENV ?? 'development';
const is_prod = mode == 'production';

/**
 * get export file
 * @param {*} file 
 * @returns 
 */
function _fs_exports(file) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    return __dirname + "/exports/" + file;
}

async function init_env(option) {
    if ('_init' in __app_environment) {
        let p = await exec_cmd("--env --no-color", option);
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
 * init command
 * @param {*} cmd 
 * @returns 
 */
const exec_cmd = async function (cmd, option) {
    var rp = await new Promise((resolve, reject) => {
        const { controller, cwdir } = option || __baseOptions;
        const r = ['balafon'];
        r.push(cmd);
        if (controller) {
            r.push('--controller:' + controller);
        }
        if (cwdir) {
            r.push('--wdir:' + cwdir);
        }
        exec(r.join(' '), (err, stdout, stderr) => {
            if (!err) {
                return resolve(stdout);
            }
            return reject(stderr);
        })
    }).catch((e) => {
        console.log("["+__PLUGIN_NAME__+"] - error - ", e, "\n");
    });
    return rp;
};

const watchForProjectFolder = (option) => {

    return {
        configureServer(server) {
            const { cwdir } = option;
            if (cwdir) {

                server.watcher.add(cwdir);
                server.watcher.on('change', (file) => {
                    file = normalizePath(file);
                    if (/\/Data\/config\.xml$/.test(file)) {
                        server.restart();
                    } else if (/\.(phtml|pcss|bview|php|css|xml)$/.test(file)) {
                        // + | invalidate styling virtual module
                        const mod_graph = server.moduleGraph;
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
 * view only environement definition 
 * @param {*} option 
 * @returns 
 */
const viewControllerDefinition = (option) => {
    const { controller, cwdir } = option;
    if (controller) {
        return {
            name: "balafon:view-controller-env-definition",
            enforce: 'post',
            apply: 'build',
            async closeBundle() {
                let cmd = '--env --controller:' + controller;
                if (cwdir) {
                    cmd += ' --wdir:' + cwdir;
                }
                let src = await exec_cmd(cmd);
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
 * @returns 
 */
const virtualReferenceHandler = (option) => {
    const resolve_ids = {};
    let _container = null, v_option = null, _vue_plugins = null;
    const to_asset_code = function (q, name, source, { ref }) {
        let p = option.buildCoreAssetOutput ?? 'balafon';
        name = path.join(p, name);
        let js = q.emitFile({
            type: 'asset',
            name,
            source
        });
        arguments[3].ref = js;
        let code = `export default (()=>import(import.meta.ROLLUP_FILE_URL_${js}))()`;
        return { code, map: null };
    };
    const entries = [];
    const v_modules = {
        'core.js': function () {
            return entries['core.js'];
        },
        'core.css.js': function () {
            return entries['core.css.js'];
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
                src = await exec_cmd('--js:dist');
                src = src.replace(/\bimport\b\s*\(/g, "import(/* @vite-ignore */");
            } 
            if (is_prod) {
                const _id = 'core.js';
                if (!option.buildCoreJSAsAsset) {
                    let p = option.buildCoreAssetOutput ?? 'balafon';
                    // + | emit as cunk
                    let tref = this.emitFile({
                        type: 'chunk',
                        id: _id,
                        name: p + '/core',
                        preserveSignature: 'strict'
                    });
                    entries[_id] = src;
                    return 'export default (()=>import(import.meta.ROLLUP_FILE_URL_' + tref + '))()';
                }
                let ref = { ref: null }
                return to_asset_code(this, _id, src, ref);
            }
            return ['export default (()=>{ ',
                src,
                ' return globalThis.igk; })()'
            ].join('');
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
            let cmd = controller ? '--project:css-dist ' + controller : '--css:dist';
            cmd += ' --set-env:IGK_VITE_APP=1'
            let src = await exec_cmd(cmd, option);
            src = btoa(src);
            let j = `const _oc = atob("` + src + `"); export default (()=>{ if (typeof(document)=='undefined') return null; let l = document.createElement("style"); document.body.appendChild(l); l.append(_oc); return l;})();`;
            if (is_prod) {
                if (!option.buildCoreJSAsAsset) {
                    const _id = 'core.css.js';
                    let p = option.buildCoreAssetOutput ?? 'balafon';
                    // emit as cunk
                    let tref = this.emitFile({
                        'type': 'chunk',
                        'id': _id,
                        'name': p + '/core.css'
                    });
                    entries[_id] = j;
                    return 'export default (()=>import(import.meta.ROLLUP_FILE_URL_' + tref + '))()';
                }
                let ref = { ref: null };
                return to_asset_code(this, '/core.css.js', j, ref);
            }
            return j;
        },
        'virtual:balafon-project-settings': async function () {
            const { defaultUser } = option;
            let extra = '';
            if (defaultUser) {
                extra += ' --user:' + defaultUser;
            }

            let src = await exec_cmd('--vite:project-settings' + extra, option);
            if (src.length == 0)
                src = "{}";
            return {
                code: `export default ${src}`
            }
        },
        'virtual:balafon-utility': async function () {
            let { target } = _config_option;
            return `const _data = ${JSON.stringify(({ target }))}; const initVueApp= (app)=>{app.mount(_data.target|| '#app'); return app;}; export { initVueApp };`;
        },
        'virtual:balafon-vite-app': async function () {
            let _file = fs.readFileSync(_fs_exports('/app.js.template'), 'utf-8');
            // + |  treat code file
            _file = _file.replace('%target%', option.target ? '"' + option.target + '"' : 'null')
            return {
                'code': _file
            }
        },
        'virtual:balafon-iconslib': async function () {
            let _file = fs.readFileSync(_fs_exports('/iconlib.vue.template'), 'utf-8');
            let _plugins = _vue_(v_option.plugins);
            let _result = null;
            // + |  treat code file
            _file = _file.replaceAll('%default_lib%', option.icons['\0default_lib'] ?? 'ionicons')
            if (_plugins) {
                _result = await _plugins.transform(_file, 'virtual:balafon-iconslib.vue');// must end with .vue to be properly transformed
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
            let _lf = logo ? path.resolve(__dirname, logo): null
            if (_lf && fs.existsSync(_lf)) {
                g = fs.readFileSync(_lf, 'utf-8');
            } else {
                if (!controller) {
                    return 'import * as Vue from "vue"; const {h} = Vue; export default {render(){return h("div", "logo")}}';
                }
                g= await exec_cmd(`--project:info ${controller} --logo`);
            }
            let code = null;
            let _p_vue_plugin = _vue_(v_option.plugins);
            if (g && _p_vue_plugin) {
                // + | transform svg content to template using vue:plugin trans form 
                g = g.substring(g.indexOf("<svg"))
                g = '<template><span class="logo">' + g + '</span></template>';
                code = await _p_vue_plugin.transform(g, 'virtual:balafon-logo.vue');
                return code;
            }
        }
    };
    const v_idxs = {};
    __ids.idxs = v_idxs;
    function _vue_(plugins) {
        return (_vue_plugins === null) ? (_vue_plugins = (() => {
            _vue_plugins = 0;
            plugins.forEach((i) => { if (i.name == 'vite:vue') _vue_plugins = i; })
            return _vue_plugins;
        })()) : _vue_plugins;
    }


    return {
        name: "balafon:virtual-reference",
        configResolved(option) {
            v_option = option;
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
        },
        /**
         * 
         * @param {*} id 
         */
        async load(id) {
            if (id in v_idxs) {
                let v_name = v_idxs[id];
                let fc = v_modules[v_name];
                return fc.apply(this, [option]);
            }
        }
    }
};
/**
 * 
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
                const src = await exec_cmd('--favicon --type:png')
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
 * @returns 
 */
const initEnv = (option) => {
    return {
        async config(conf) {
            await init_env(option);
            const { controller } = option;
            let { cwdir } = option;
            if (controller && !cwdir) {
                let info = await exec_cmd(`--project:info ${controller} --base-dir`);
                if (info){
                    cwdir = info.trim();
                    option.cwdir = cwdir;
                }
            }
            if (!cwdir || !controller) {
                return;
            }
            const env = loadEnv(mode, cwdir);
            env.VITE_IGK_CONTROLLER = controller;
            env.VITE_IGK_ENTRY_URL = env['VITE_URL'] + __app_environment.entryuri;
            const list = {};
            // transform to definition sample
            for (let j in env) {
                list[j] = JSON.stringify(env[j]);
            }
            conf.define = merge_properties(conf.define, {
                ...list
            }, true);

            conf.base = __app_environment.entryuri;

            conf.resolve.alias['@core-views'] = cwdir + "/Views";

        }
    };
}
/**
 * 
 * @param {*} option 
 * @returns 
 */
const balafonIconLib = (option) => {
    const { icons } = option;
    // +| retrieve command
    const _get_cmd = function (cacheddata) {
        let lib = [];
        for (let i in icons) {
            if (i.startsWith('\0')) continue;
            let s = '';
            let l = icons[i];
            s += i + ',';
            if (Array.isArray(l)) {

                let p = cacheddata[i];
                if (p) {
                    const tl = l[1].split(',');

                    p.forEach(s => {
                        if (tl.indexOf(s) == -1) {
                            tl.push(s);
                        }
                    })
                    l[1] = tl.join(',');//.split(',').forEach()
                }

                s += l.join('\\;');
            } else {
                s += l;
            }
            lib.push('--library:' + s);
        }
        return lib.length > 0 ? lib.join(' ') : null;
    };
    const ref_emits = [];
    let top_conf = null;
    function chunkPrefix(option) {
        return option.buildCoreAssetOutput ?? 'balafon';
    }
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
                    const cmd = _get_cmd(data);
                    // + | emit only work on production -
                    let src = await exec_cmd('--vue3:convert-svg-to-js-lib ' + cmd);

                    if (is_ssr) {
                        // direct export 
                        return ['import * as Vue from \'vue\'; ', src].join("\n");
                    }

                    if (!option.buildIconLibAsAsset) {
                        // + | emit as cunk
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
                        //return 'export default (async ()=> await import(import.meta.ROLLUP_FILE_URL_' + tref + '))()';
                        return 'export default (()=> import(import.meta.ROLLUP_FILE_URL_' + tref + '))()';
                    }
                    let ref1 = this.emitFile({
                        type: 'asset',
                        name: 'svg-lib.js',
                        source: src,

                    })
                    ref_emits.push(ref1);
                    let code = `export default (()=>import(import.meta.ROLLUP_FILE_URL_${ref1}))()`;
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
            ref_emits.forEach((o) => {
                let n = this.getFileName(o);
                n = n.replace(".", "\\.");

                m.push(new RegExp(
                    '(import\\(new URL\\("' + n + '",import\\.meta\\.url\\)\\.href\\))', 'g'
                ));

            });
            if (option.format == 'es') {
                for (let i in bundle) {
                    const file = bundle[i];
                    if (i.endsWith('.js') && (file.type == 'chunk')) {
                        let code = file.code;
                        if (code) {
                            m.forEach((n) => {
                                code = code.replace(n, '(await $1).default');
                            });
                            // fix writing lib 
                            file.code = code;
                        }
                    }
                }
            }
        }
    };
};

/**
 * icons library
 * @param {*} option 
 * @returns 
 */
const balafonIconLibraryAccess = (option) => {
    const store = {};
    let v_option = null;
    let _vue_plugins = null;
    function _vue_(plugins) {
        return (_vue_plugins === null) ? (_vue_plugins = (() => {
            _vue_plugins = 0;
            plugins.forEach((i) => { if (i.name == 'vite:vue') _vue_plugins = i; })
            return _vue_plugins;
        })()) : _vue_plugins;
    }
    return {
        name: "balafon:libicons-library-access",
        apply: "serve",
        configResolved(option) {
            v_option = option;
        },
        async resolveId(id) {
            if (id.startsWith('virtual:icons/')) {
                return '\0' + id;
            } else if (id.startsWith('/@id/__x00__virtual:icons/')) {
                return '\0' + id.replace('/@id/__x00__virtual:icons/', 'virtual:icons/');
            }
        },
        async load(id) {
            if (id.startsWith('\0virtual:icons/')) {
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
                    const fpath = '--single --library:' + lib + ',' + location[0] + "\\;" + name;
                    src = await exec_cmd('--vue3:convert-svg-to-js-lib ' + fpath);
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
                // let _spath = path.resolve(_out_dir, 'entry-server.js');
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

export {
    removeIndexHtml,
    addFavicon,
    virtualReferenceHandler,
    viewControllerDefinition,
    initEnv,
    balafonSSRLoading,
    balafonIconLibraryAccess,
    balafonIconLib,
    balafonSSRComponent
}
const globalInitialize = (option) => {
    return {
        name: 'vite-plugin:balafon-global-init',
        configResolved(conf) {
            _globalConf = conf;
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
    let _serv_comp_ref = null;
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
                _conf.resolve.alias[srv] = "";// process.loadEnvFile()
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
                    //  return 'export * from "https://local.com:7300/testapi/vite/backend-integration/'+id+'";';
                    // return ['import * as f from "'+ componentUri + '/' + id +'";', 
                    //         'export default f.default'].join("\n");

                    let r = await exec_cmd("--request:curl '" + componentUri + '/' + id + "?mode=production&target=ssr'");
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
 * plugins function
 */
export default async (option) => {
    console.log(cli.blueBright('igkdev') + ' - plugin ' + cli.green(__PLUGIN_NAME__))
    option = merge_properties(option, __baseOptions);
    merge_properties(_config_option, option);

    if (!option.icons) {
        option.icons = {};
    }
    return [
        globalInitialize(option),
        removeIndexHtml(option),
        addFavicon(option),
        virtualReferenceHandler(option),
        watchForProjectFolder(option),
        initEnv(option),
        balafonSSRLoading(option),
        balafonIconLibraryAccess(option),
        balafonIconLib(option),
        balafonSSRComponent(option)
    ];
}