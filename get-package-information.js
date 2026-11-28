function getName(){
    return require('./package.json').name;
}

function getFullVersion() {
    const version = require('./package.json').version;
    const versionSuffix = require('./package.json').versionSuffix;

    if(versionSuffix === ""){
        return version;
    }

    return version + "-" + versionSuffix;
}

/** 'dev' for every build except the ones the release workflow makes ('release'). */
function getChannel() {
    return require('./package.json').apoloxChannel === 'release' ? 'release' : 'dev';
}

function getCopyright(){
    return require('./package.json').copyright;
}

module.exports.getName = getName;
module.exports.getFullVersion = getFullVersion;
module.exports.getCopyright = getCopyright;
module.exports.getChannel = getChannel;