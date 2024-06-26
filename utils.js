const {ungzip} = require('node-gzip');

if (! String.prototype.replaceAll) {
    String.prototype.replaceAll = function(a, b) {
        return this.split(a).join(b);
    }
}

String.prototype.replaceNC = function(a, b) {
    let reg = new RegExp(a, "ig");
    return this.replaceAll(reg, b);
}

module.exports = {
    consumeBody: function(res) {
        return new Promise(function(resolve, reject) {
            let body = Buffer.from('');
            res.on('data', (chunk) => {
                if (chunk) {
                    body = Buffer.concat([body, chunk])
                }
            })
            res.on('end', async function() {
                if (res.headers['content-encoding'] === 'gzip') {
                    try {
                        body = await ungzip(body);
                    } catch(e){}
                }
                resolve(body)
            })
        })
    },
    transformArgs: function(url) {
        let args = {};
        let idx = url.indexOf('?');
        if (idx != -1) {
            let s = url.slice(idx+1);
            let parts = s.split('&');
            for (let i=0; i<parts.length; i++) {
                let p = parts[i];
                let idx2 = p.indexOf('=');
                try {
                    args[decodeURIComponent(p.slice(0,idx2))] = decodeURIComponent(p.slice(idx2+1,s.length));
                } catch(e) {}
            }
        }
        return args;
    },
    removeArg: function(url, argName) {
        if (!url.split('?').pop().includes(argName+'=')) {
            return url;
        }
        return url.replace(argName+url.split('?').pop().split(argName).pop().split('&')[0], '')
    },
    check4Redirects: function(url, allRedirects) {
        return new Promise(function(resolve, reject) {
            let protReq = url.startsWith('https:') ? https : http;
            protReq.get(url, function(res) {
                try {
                    let {statusCode} = res;
                    if ([301, 302, 307].includes(statusCode) &&
                        res.headers['location'] &&
                        (allRedirects ||(new URL(res.headers['location'])).pathname === '/')) {
                        res.resume();
                        resolve(res.headers['location']);
                    } else {
                        res.resume();
                        resolve(false);
                    }
                } catch(e) {
                    res.resume();
                    resolve(false);
                }
            }).on('error', reject);
        })
    },
    getFolderImage: function(files, magnet, fileName) {
        let paths = [];
        for (let i=0; i<files.length; i++) {
            paths.push(files[i].path);
        }
        function processFiles(a) {
            a = a.sort(function(a, b) {
                return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            });
            let q;
            for (let i=0; i<a.length; i++) {
                if (a[i].isDirectory) {
                    let b = processFiles(a[i].children);
                    if (b) {
                        return b;
                    }
                } else if (fileName && a[i].path === fileName) {
                    let c = a;
                    for (let o=0; o<c.length; o++) {
                        if (c[o].isDirectory) continue;
                        let mime = MIMETYPES[c[o].path.toLowerCase().split('.').pop()];
                        if (mime.split('/')[0] === 'image' && ['cover', 'folder'].includes(c[o].path.toLowerCase().split('/').pop().split('\\').pop().split('.')[0].split('_')[0].split(' ')[0])) {
                            return {mime, path:'/torrentStream?fileName='+encodeURIComponent(c[o].path)+'&magnet='+magnet};
                        }
                    }
                } else {
                    if (q) continue;
                    let mime = MIMETYPES[a[i].path.toLowerCase().split('.').pop()];
                    if (mime.split('/')[0] === 'image' && ['cover', 'folder'].includes(a[i].path.toLowerCase().split('/').pop().split('\\').pop().split('.')[0].split('_')[0].split(' ')[0])) {
                        q = {mime, path:'/torrentStream?fileName='+encodeURIComponent(a[i].path)+'&magnet='+magnet};
                    }
                }
            }
            return q;
        }
        return processFiles(fileTree(paths));
    },
    getConcurentFiles: function(currentFile, files, magnet) {
        let paths = [];
        for (let i=0; i<files.length; i++) {
            paths.push(files[i].path);
        }
        function processFiles(a) {
            a = a.sort(function(a, b) {
                return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            });
            for (let i=0; i<a.length; i++) {
                if (a[i].isDirectory) {
                    let b = processFiles(a[i].children);
                    if (b) {
                        return b;
                    }
                } else if (a[i].path === currentFile) {
                    let out = [];
                    if (a[i+1]) {
                        out[1] = '/torrentStream?fileName='+encodeURIComponent(a[i+1].path)+'&stream=on&magnet='+magnet;
                    } else {
                        out[1] = null;
                    }
                    if (a[i-1]) {
                        out[0] = '/torrentStream?fileName='+encodeURIComponent(a[i-1].path)+'&stream=on&magnet='+magnet;
                    } else {
                        out[0] = null;
                    }
                    return out;
                }
            }
        }
        return processFiles(fileTree(paths));
    },
    fileTree: function(paths) {
        let result = [];
        let level = {result};
        paths.forEach(info => {
            let path=info.path, size=info.size;
            if (typeof info == 'string') path = info;
            path.split('/').reduce((r, name, i, a) => {
                if(!r[name]) {
                    r[name] = {result: []};
                    r.result.push({name, children: r[name].result, path, size:size})
                }
                return r[name];
            }, level)
        })
        function folderSizes(a) {
            let size = 0;
            for (let i=0; i<a.length; i++) {
                if (a[i].isFile) {
                    size += a[i].size;
                } else {
                    size += folderSizes(a[i].children);
                }
            }
            return size;
        }
        function process(a) {
            for (let i=0; i<a.length; i++) {
                if (a[i].children.length > 0) {
                    a[i].isFile = false;
                    a[i].isDirectory = true;
                    a[i].children = process(a[i].children);
                    a[i].path = a[i].path.substring(0, a[i].path.length-a[i].path.split(a[i].name).pop().length);
                    a[i].size = folderSizes(a[i].children);
                    if (!a[i].path.endsWith('/')) {
                        a[i].path += '/';
                    }
                } else {
                    a[i].isFile = true;
                    a[i].isDirectory = false;
                    delete a[i].children;
                }
            }
            return a;
        }
        return process(result);
    },
    generateTorrentTree: function(files, magnet) {
        let paths = [];
        for (let i=0; i<files.length; i++) {
            paths.push({path:files[i].path,size:files[i].length});
        }
        let result = fileTree(paths);
        let out = '<style>ul,#myUL{list-style-type:none}#myUL{margin:0;padding:0}.caret{cursor:pointer;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}.caret::before{content:"\\25B6";color:#000;display:inline-block;margin-right:6px}.caret-down::before{-ms-transform:rotate(90deg);-webkit-transform:rotate(90deg);transform:rotate(90deg)}.nested{display:none}.active{display:block}</style><ul id="myUL">';
        function processFiles(a) {
            a = a.sort(function(a, b) {
                return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            });
            for (let i=0; i<a.length; i++) {
                if (a[i].isDirectory) {
                    let q = '/torrentStream?download=1&zip=1&directory2DL='+a[i].path+'&magnet='+magnet
                    out += '<li><span class="caret">'+a[i].name+'</span> (<a href="'+q+'">download</a>) ('+humanFileSize(a[i].size)+')<ul class="nested">';
                    processFiles(a[i].children);
                    out += '</ul></li>';
                } else {
                    let downloadUrl = '/torrentStream?fileName='+encodeURIComponent(a[i].path)+'&stream=on&magnet='+magnet;
                    let downloadUrl2 = '/torrentStream?fileName='+encodeURIComponent(a[i].path)+'&download=1&magnet='+magnet;
                    out += '<li><a style="text-decoration:none" href="'+downloadUrl+'">'+a[i].name+'</a> - <a style="text-decoration:none" href="'+downloadUrl2+'">download</a> ('+humanFileSize(a[i].size)+')</li>';
                }
            }
        }
        processFiles(result);
        out += '</ul><script>for(let toggler=document.getElementsByClassName("caret"),i=0;i<toggler.length;i++)toggler[i].addEventListener("click",function(){this.parentElement.querySelector(".nested").classList.toggle("active"),this.classList.toggle("caret-down")});</script>';
        return out;
    },
    bodyBuffer: function(body) {
        return Buffer.concat([Buffer.from(new Uint8Array([0xEF,0xBB,0xBF])), Buffer.from(body)]);
    },
    isNotGoodSite: function(url) {
        const keywords = [
            atob('cG9ybg=='),
            atob('c2V4'),
            atob('eHZpZGVvcw=='),
            atob('ZnVjaw==')
        ];
        for (let i=0; i<keywords.length; i++) {
            if (url.toLowerCase().includes(keywords[i])) {
                return true;
            }
        }
        return false;
    },
    createHttpHeader: function(line, headers) {
        return Object.keys(headers).reduce(function(head, key) {
            let value = headers[key];
            if (!Array.isArray(value)) {
                head.push(key + ': ' + value);
                return head;
            }
            for (let i = 0; i < value.length; i++) {
                head.push(key + ': ' + value[i]);
            }
            return head;
        }, [line]).join('\r\n')+'\r\n\r\n';
    },
    processUrl: function(url, host, opts) {
        url = url.startsWith('/http') ? url.substring(1) : opts.site2Proxy+url;
        if (url.startsWith('https:/') &&
            !url.startsWith('https://')) {
            url = url.replace('https:/', 'https://');
        }
        if (url.startsWith('http:/') &&
            !url.startsWith('http://')) {
            url = url.replace('http:/', 'http://');
        }
        if (url.startsWith('https://https:/')) {
            url = url.replace('https://https:/', 'https:/');
        }
        if (url.startsWith('http://http:/')) {
            url = url.replace('http://http:/', 'http:/');
        }
        let args = transformArgs(url);
        url = removeArg(url, 'vc');
        url = removeArg(url, 'nc');
        url = removeArg(url, 'video');
        if (url.endsWith('?')) {
            url = url.substring(0, url.length-1);
        }
        url=url.replaceAll('https%3A%2F%2F%2F', '')
            .replaceAll('https%3A%2F'+host, 'https%3A%2F%2F'+host);
        return {args:args, url:url};
    },
    humanFileSize: function(bytes) {
        if (! bytes) {
            return '';
        }
        //from https://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable-string/10420404
        const thresh = 1024;
        if (Math.abs(bytes) < thresh) {
          return bytes + ' B';
        }
        const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
        let u = -1;
        const r = 10;
        do {
          bytes /= thresh;
          ++u;
        } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);
        return bytes.toFixed(1) + ' ' + units[u];
    },
    getOpts: function(cookies) {
        let opts = {};
        if (cookies && cookies.includes('proxySettings=')) {
            opts.site2Proxy = decodeURIComponent(cookies.split('proxySettings=').pop().split(';')[0].split('_')[0]);
            opts.proxyJSReplace = (cookies.split('proxySettings=').pop().split(';')[0].split('_')[1] === '1');
            opts.isAbsoluteProxy = (cookies.split('proxySettings=').pop().split(';')[0].split('_')[2] === '1');
            opts.useHiddenPage = (cookies.split('proxySettings=').pop().split(';')[0].split('_')[3] === '1');
            opts.replaceExternalUrls = (cookies.split('proxySettings=').pop().split(';')[0].split('_')[4] === '1');
            opts.allowAdultContent = (cookies.split('proxySettings=').pop().split(';')[0].split('_')[5] === '1');
            opts.noChange = (cookies.split('proxySettings=').pop().split(';')[0].split('_')[6] === '1');
        }
        return opts;
    },
    end: function(html, res, type, code) {
        if (type) {
            res.setHeader('content-type', type);
        }
        html = bodyBuffer(html);
        res.setHeader('content-length', html.byteLength);
        res.writeHead(code || 200);
        res.end(html);
    },
    redirect: function(url, res, type) {
        res.setHeader('location', url);
        res.setHeader('content-length', 0);
        res.writeHead(type);
        res.end();
    }
}
