# balafon-vite-plugin

help handling balafon project configuration. 

- author : C.A.D. BONDJE DOUE ([cbondje@igkdev.com])

## require

- balafon php framework
- balafon cli must be installed as global path (and be executable for UNIX system)

> check with this command:

```bash
balafon --version
```

## installation 

```bash
npm -i balafon-vite-plugin
```
or 
```bash
yarn add balafon-vite-plugin
```

Note: this package depend on `cli-color` and `oslllo-svg2` 

## usage
- in vite.config.js

```js
import balafon from 'balafon-vite-plugin'

export default defineConfig({
    // ...
    plugins:[
        // ...
        balafon()
    ]
})

```