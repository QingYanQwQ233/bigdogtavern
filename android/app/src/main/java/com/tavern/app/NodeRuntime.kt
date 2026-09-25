package com.tavern.app

/**
 * nodejs-mobile JNI 桥的 Kotlin 侧入口。
 *
 * 加载 libnode_bridge 时，动态链接器会按 DT_NEEDED 自动带起 libnode.so，
 * 因此这里不需要（也无法）单独 System.loadLibrary("node")。
 *
 * 包名必须与 android/native/node_bridge.cpp 里的
 * `Java_com_tavern_app_NodeRuntime_startNode` 保持一致。
 */
object NodeRuntime {

    init {
        System.loadLibrary("node_bridge")
    }

    /**
     * 在后台线程启动内嵌 Node 运行时（本调用立即返回，不阻塞）。
     *
     * @param args 传给 node 的参数，例如 ["node", "/abs/path/server.js"]
     * @param cwd Node 进程的工作目录（server.js 的相对路径以此为基准）
     * @param redirectToLogcat 是否把 stdout/stderr 重定向到 logcat（tag=NodeOutput）
     * @return 0 表示线程已拉起；-1 表示创建线程失败
     */
    external fun startNode(args: Array<String>, cwd: String, redirectToLogcat: Boolean): Int
}
