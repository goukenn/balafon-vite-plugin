import path from 'path'
import fs from 'fs'
import cli from 'cli-color'
import { exec } from 'child_process';
import Svg2  from 'oslllo-svg2';

const __dirname = process.env.INIT_CWD;

const exec_cmd = async function (cmd) {
    var rp = await new Promise((resolve, reject) => {

        const r = ['balafon'];
        r.push(cmd);
        exec(r.join(' '), (err, stdout, stderr)=>{
            if (!err){
                return resolve(stdout);
            }
            return reject(stderr);
        })
    }).catch((e)=>{

    });
    return rp;
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
 * resolving virtual reference 
 * @param {*} option 
 * @returns 
 */
const virtualReferenceHandler = (option) => {
    const resolve_ids = {};
    return {
        name: "balafon/vite-plugin-virtual-reference",
        resolveId() {
        }
    }
};
const addFavicon = (option) => {
    const _ref = {};
    return {
        configResolved(option) {
            _ref.outDir = path.resolve(option.root, option.build.outDir);
        },
        async closeBundle() {
            let tpath = path.resolve(_ref.outDir, 'favicon.ico');
            if (!fs.existsSync(tpath)) { 
                // try create a favicon
                const src = await exec_cmd('--favicon')
                const data =  atob(src.trim().split(',')[1]); 
                fs.writeFileSync(tpath+'.svg', data);
                const rpath = tpath+'.svg';
                let _k = Svg2(rpath);
                // convert to png cause svg not rendering as automatic svg
                _k.png({
                    transparent:true
                }).toFile(tpath, (err)=>{
                    if (!err){
                        console.log("store "+cli.green("favicon"));
                        fs.unlinkSync(rpath);
                    }
                })
            }
        }
    }
};
export {
    removeIndexHtml,
    virtualReferenceHandler
}
export default (option) => {
    console.log(cli.blueBright('balafon') + ' - plugins ' + cli.green('@balafon/vite-plugins'))
    return [
        removeIndexHtml(option),
        addFavicon(option),
        virtualReferenceHandler(option)
    ]
}