import path from 'path'
import fs from 'fs'
import cli from 'cli-color'
import { exec } from 'child_process';
import { normalizePath, loadEnv } from 'vite';
import { fileURLToPath } from 'url';



const __dirname = process.env.INIT_CWD;
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
const is_prod = process.env.NODE_ENV == 'production';

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
        console.log("error", e);
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
                        const mod_graph = server.moduleGraph;
                        // invalvidate styling vitrual module
                        const { idxs } = __ids;
                        if (!idxs || (Object.keys(idxs).length == 0)) {
                            const module = mod_graph.getModuleById("\0virtual:balafon-corecss");
                            if (module) {
                                mod_graph.invalidateModule(module);
                            }
                        } else {
                            for (let i in idxs) {
                                const module = mod_graph.getModuleById(i);
                                if (module) {
                                    mod_graph.invalidateModule(module);
                                }
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
    let _container = null;
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
            let src = await exec_cmd('--js:dist');
            // ingore core-js import use to skip vite to analyse it
            src = src.replace(/\bimport\b\s*\(/g, "import(/* @vite-ignore */", src);

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
            let cmd = controller ? '--project:css-dist ' + controller : '--css:dist';
            cmd += ' --set-env:IGK_VITE_APP=1'
            let src = await exec_cmd(cmd, option);
            src = btoa(src);
            let j = `export default (()=>{let l = document.createElement("style"); document.body.appendChild(l); l.append(atob("` + src + `")); return l;})();`;
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
        // 'virtual:icons/ionicons/accessibility': async function(){
        //     return `export default {render(){const{h}=Vue;return h('svg',{height:512,viewBox:'0 0 512 512',width:512,xmlns:'http://www.w3.org/2000/svg',innerHTML:'<line style="fill:none;stroke:#000;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px" x1="256" x2="256" y1="112" y2="400"></line><line style="fill:none;stroke:#000;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px" x1="400" x2="112" y1="256" y2="256"></line>'})}}`;
        //     //return "export default (()=>{ const { h } = Vue;  return {render(){return h('sample'); }} })()";
        // },
        'virtual:balafon-svg/sfsymbols': async function () {

        },
        'virtual:balafon-svg/ionicons': async function () {

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
            let _plugins = _vue_();
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
        }
    };
    const v_idxs = {};
    let v_option = null;
    __ids.idxs = v_idxs;
    let _vue_plugins = null;
    function _vue_() {
        return (_vue_plugins == null) ? (_vue_plugins = (() => {
            v_option.plugins.forEach((i) => { if (i.name == 'vite:vue') _vue_plugins = i; })
            return _vue_plugins;
        })()) : _vue_plugins = 0;
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
            const { cwdir, controller } = option;
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

const _cached_libicons = function () {

};
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

                if (is_prod) {
                    const r = this.cache.get('d');
                    const data = ((f) => {
                        if (fs.existsSync(f)) {
                            return JSON.parse(fs.readFileSync(f, 'utf-8'));
                        }
                    })(top_conf.cacheDir + '/.balafon/icons.lib.json');
                    const cmd = _get_cmd(data);
                    // + | emit only work on production -
                    let src = await exec_cmd('--vue3:convert-svg-to-js-lib ' + cmd);

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
                        return 'export default (()=>import(import.meta.ROLLUP_FILE_URL_' + tref + '))()';
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
                //return { code: 'export default null;', map: null }
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
                            // if (/\/svg-lib.js$/.test(i)){
                            //code = 'export default '+code;
                            // }
                            file.code = code;
                        }
                    }
                }
            }
        }
    };
};

const balafonIconLibraryAccess = (option) => {
    const store = {};
    return {
        name: "balafon:libicons-library-access",
        apply: "serve",
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
                const fpath = '--single --library:' + lib + ',' + location[0] + "\\;" + name;

                const src = await exec_cmd('--vue3:convert-svg-to-js-lib ' + fpath);
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
        },
        async buildEnd(error) {
            console.log("build end ");
        }
    }
}

export {
    removeIndexHtml,
    addFavicon,
    virtualReferenceHandler,
    viewControllerDefinition,
    initEnv,
    balafonIconLibraryAccess,
    balafonIconLib
}
/**
 * 
 */
export default async (option) => {
    console.log(cli.blueBright('balafon') + ' - plugin ' + cli.green('vite-plugin-balafon'))
    option = merge_properties(option, __baseOptions);
    merge_properties(_config_option, option);
    return [
        removeIndexHtml(option),
        addFavicon(option),
        virtualReferenceHandler(option),
        watchForProjectFolder(option),
        initEnv(option),
        balafonIconLibraryAccess(option),
        balafonIconLib(option)
    ];
}