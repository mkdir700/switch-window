const exec = require('child_process').exec;

async function cmd(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                reject(error)
            }
            resolve(stdout ? stdout : stderr);
        });
    });
}

function takeCaptureGroup(data, regex, group) {
    return data.match(regex)[group]
}

const WMCTRL_LIST_REGEX = /(0x[^\s]*)\s*([^\s]*)\s*([^\s]*)\s*(.*)/
function parseWmctrl(lines) {
    const list = lines.split(/\r?\n/) // split into lines
        .filter(line => line.length != 0); // ingore invalid line
    return list.map(line => {
        const match = line.match(WMCTRL_LIST_REGEX);
        return {
            id: match[1],
            title: match[4]
        };
    });
}

// 窗口使用频率管理
class WindowUsageManager {
    constructor() {
        this.DB_PREFIX = 'window_usage_';
    }

    // 获取窗口使用频率数据
    getWindowUsage(windowId) {
        const docId = this.DB_PREFIX + windowId;
        const doc = window.utools.db.get(docId);
        if (doc) {
            return doc;
        }
        return {
            _id: docId,
            windowId: windowId,
            count: 0,
            lastUsed: 0
        };
    }

    // 更新窗口使用频率
    updateWindowUsage(windowId, title) {
        const doc = this.getWindowUsage(windowId);
        doc.count += 1;
        doc.lastUsed = Date.now();
        doc.title = title; // 保存最新的窗口标题
        
        const result = window.utools.db.put(doc);
        if (result.ok) {
            doc._rev = result.rev;
        }
        return doc;
    }

    // 获取所有窗口使用数据
    getAllWindowUsage() {
        return window.utools.db.allDocs(this.DB_PREFIX);
    }

    // 根据使用频率和最近使用时间对窗口列表排序
    sortWindowsByUsage(windows) {
        const usageData = this.getAllWindowUsage();
        const usageMap = {};
        
        // 创建使用数据映射
        usageData.forEach(doc => {
            usageMap[doc.windowId] = {
                count: doc.count,
                lastUsed: doc.lastUsed
            };
        });

        // 对窗口列表排序
        return windows.sort((a, b) => {
            const usageA = usageMap[a.id] || { count: 0, lastUsed: 0 };
            const usageB = usageMap[b.id] || { count: 0, lastUsed: 0 };
            
            // 首先按使用次数排序，次数相同则按最近使用时间排序
            if (usageB.count !== usageA.count) {
                return usageB.count - usageA.count;
            }
            return usageB.lastUsed - usageA.lastUsed;
        });
    }
}

const windowUsageManager = new WindowUsageManager();

class Wmctrl {
    constructor() {

    }
    async list() {
        const list = await cmd("wmctrl -l")
        const windows = parseWmctrl(list);
        // 根据使用频率排序窗口列表
        return windowUsageManager.sortWindowsByUsage(windows);
    }
    async active(win) {
        // 找到窗口的完整信息
        const list = await cmd("wmctrl -l");
        const windows = parseWmctrl(list);
        const window = windows.find(w => w.title === win.trim());
        
        if (window) {
            // 更新窗口使用频率
            windowUsageManager.updateWindowUsage(window.id, window.title);
        }
        
        await cmd(`wmctrl -a "${win.trim()}"`)
    }
}

const wmctrl = new Wmctrl();

// 全局变量，用于存储当前的回调函数和窗口列表
let globalCallbackSetList = null;
let globalAction = null;

async function asyncEnter(utools, action, callbackSetList) {
    // 保存全局回调函数和 action
    globalCallbackSetList = callbackSetList;
    globalAction = action;
    
    // 获取窗口列表
    const winList = await wmctrl.list();
    
    // 渲染列表
    callbackSetList(winList.map(win => {
        return { title: win.title }
    }));
}

async function asyncSearch(utools, action, searchWord, callbackSetList) {
    // 获取窗口列表
    const winList = await wmctrl.list();
    
    callbackSetList(
        winList.filter(win => win.title.toLowerCase().includes(searchWord.toLowerCase()))
            .map(win => {
                return { title: win.title }
            }));
}

async function asyncSelect(utools, action, itemData, callbackSetList) {
    window.utools.hideMainWindow();
    await wmctrl.active(itemData.title);
    
    // 在窗口激活后，异步更新窗口列表
    setTimeout(async () => {
        await updateWindowList();
    }, 500);
}

// 更新窗口列表并重新渲染
async function updateWindowList() {
    try {
        // 确保全局回调函数存在
        if (globalCallbackSetList && globalAction) {
            console.log('正在更新窗口列表...');
            
            // 获取最新的窗口列表
            const winList = await wmctrl.list();
            
            // 使用保存的回调函数重新渲染列表
            globalCallbackSetList(winList.map(win => {
                return { title: win.title }
            }));
            
            console.log('窗口列表已更新，共 ' + winList.length + ' 个窗口');
        }
    } catch (error) {
        console.error('更新窗口列表失败:', error);
    }
}

// 初始化插件
function initPlugin() {
    // 注册插件隐藏事件
    window.utools.onPluginOut((isKill) => {
        if (!isKill) {
            // 插件被隐藏但未结束运行时，更新窗口列表
            console.log('插件被隐藏，开始更新窗口列表');
            setTimeout(async () => {
                await updateWindowList();
            }, 500);
        }
    });
    
    // 注册插件显示事件
    window.utools.onPluginEnter(({ code, type, payload }) => {
        console.log('插件进入，code:', code);
        // 如果全局回调函数存在，尝试更新列表
        if (globalCallbackSetList && globalAction) {
            setTimeout(async () => {
                await updateWindowList();
            }, 100);
        }
    });
}

window.exports = {
    "sw": {
        mode: "list",
        args: {
            enter: (action, callbackSetList) => {
                asyncEnter(window.utools, action, callbackSetList);
            },
            search: (action, searchWord, callbackSetList) => {
                asyncSearch(window.utools, action, searchWord, callbackSetList);
            },
            select: (action, itemData, callbackSetList) => {
                asyncSelect(window.utools, action, itemData, callbackSetList);
            },
            placeholder: "搜索"
        }
    }
}

// 初始化插件
initPlugin();