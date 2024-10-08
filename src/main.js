import path from 'path'
import fs from 'fs'
import cli from 'cli-color'
import { exec } from 'child_process'; 
import { normalizePath, loadEnv } from 'vite';
const __dirname = process.env.INIT_CWD;
const __baseOptions = {
    controller: null,
    cwdir: null,
    leaveIndexHtml: false,
    defaultUser: null,
    target:'app'
};
const _config_option = {};
const __ids = {};
const __app_environment = { _init: false };
const mode = process.env.NODE_ENV ?? 'development';
const is_prod = process.env.NODE_ENV == 'production'; 
 

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
        name: 'balafon/vite-plugin-rm-index',
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
                console.log('removing ' + cli.green('index.html'));
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
            name: "balafon/view-controller-env-definition",
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
    const v_modules = {
        'virtual:balafon-corejs': async function () {
            let src = await exec_cmd('--js:dist');
            // ingore core-js import use to skip vite to analyse it
            src = src.replace(/\bimport\b\s*\(/g, "import(/* @vite-ignore */", src);
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
            //  return { code: `export default (()=>{ ${j} })()` }
            return j;
            // `function _b_(t){ const c = document.createElement; if (c){ let s = c('style'); s.append(t); } } export default (()=>{ (function(){let l = \`${src}\`; let p = _b_(l); return l;})() })()`;
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
        'virtual:balafon-utility': async function(){
            let {target} = _config_option;
            return `const _data = ${JSON.stringify(({target}))}; const initVueApp= (app)=>{app.mount(_data.target|| '#app'); return app;}; export { initVueApp };`;
        }
    };
    const v_idxs = {};
    __ids.idxs = v_idxs;
    return {
        name: "balafon/vite-plugin-virtual-reference",
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
                return fc.apply(null, [option]);
            }
        }
    }
};
const addFavicon = (option) => {
    const _ref = {};
    return {
        name: "balafon/favicon-missing",
        configResolved(option) {
            _ref.outDir = path.resolve(option.root, option.build.outDir);
        },
        async closeBundle() {
            let tpath = path.resolve(_ref.outDir, 'favicon.ico');
            if (!fs.existsSync(tpath)) {
                // try create a favicon
                const src = await exec_cmd('--favicon --type:png')
                const data = atob(src.trim().split(',')[1]);
                const dir_name = path.dirname(tpath);
                if (!fs.existsSync(dir_name)) {
                    fs.mkdirSync(dir_name, { recursive: true });
                }
                fs.writeFileSync(tpath + '.png', data);
                // fs.writeFileSync(tpath + '.svg', data);
                // const rpath = tpath + '.svg';
                // let _k = Svg2(rpath);
                // convert to png cause svg not rendering as automatic svg
                // _k.png({
                //     transparent: true
                // }).toFile(tpath, (err) => {
                //     if (!err) {
                //         console.log("store " + cli.green("favicon"));
                //         fs.unlinkSync(rpath);
                //     }
                // })
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
            if (!cwdir || !controller){
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

        }
    };
}

/**
 * use to initialize vue application with balafon core setting
 * @param {*} init 
 */
const initVueApp = (app)=>{
    app.mount(option.target);
    return app;
}
/**
 * create vuew application utility 
 * @param {*} option 
 * @returns 
 */
const createVueApp = (option)=>{
    return {

    }
};

export {
    removeIndexHtml,
    addFavicon,
    virtualReferenceHandler,
    viewControllerDefinition,
    initEnv,
    initVueApp
}
/**
 * 
 */
export default async (option) => {
    console.log(cli.blueBright('balafon') + ' - plugin ' + cli.green('balafon-vite-plugin'))
    option = merge_properties(option, __baseOptions);
    merge_properties(_config_option, option);
    return [
        removeIndexHtml(option),
        addFavicon(option),
        virtualReferenceHandler(option),
        // viewControllerDefinition(option),
        watchForProjectFolder(option),
        initEnv(option), 
        createVueApp(option)
    ];
}