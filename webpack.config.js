const path = require('path');


module.exports = {
    mode:'production',
    entry:'./src/main.js', 
    output:{
        clean:true,
        path: path.resolve(__dirname)+"/dist",
        filename:"main.js"
    },
    target: 'node'
}