// JNI 胶水：加载 nodejs-mobile 的 libnode.so，在后台线程里执行任意脚本（server.js）。
//
// 设计要点：
//  1. 本库不自己实现任何后端逻辑，只负责「把 Node 跑起来」——后端唯一来源是仓库里的 server.js。
//  2. node::Start 是阻塞的，必须放到独立线程；调用方（Kotlin）拿到返回值即代表线程已拉起。
//  3. stdout/stderr 重定向到 logcat（tag=NodeOutput），方便在真机上观察 server.js 的输出。
//  4. chdir 到传入的 cwd，让 server.js 里基于 __dirname 的相对路径落在应用私有目录。
//
// 注意：JNI 函数名里的包路径（com_tavern_app）必须与 Kotlin 侧 object NodeRuntime 的包名一致，
// 否则运行期会抛 UnsatisfiedLinkError。
#include <jni.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <android/log.h>

#include "node.h"

#define TAG "NodeBridge"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

namespace {

struct StartArgs {
    int argc;
    char** argv;
    std::string cwd;
    bool redirect;
};

// ---- stdout / stderr -> logcat ----
int g_pfdOut[2];
int g_pfdErr[2];

void* redirectThread(void* arg) {
    int fd = static_cast<int>(reinterpret_cast<intptr_t>(arg));
    char buf[2048];
    ssize_t n;
    while ((n = read(fd, buf, sizeof(buf) - 1)) > 0) {
        if (buf[n - 1] == '\n') --n;
        buf[n] = 0;
        __android_log_write(ANDROID_LOG_INFO, "NodeOutput", buf);
    }
    return nullptr;
}

void startRedirectingStdoutStderr() {
    setvbuf(stdout, nullptr, _IOLBF, 0);
    if (pipe(g_pfdOut) != 0 || pipe(g_pfdErr) != 0) {
        LOGE("pipe() failed, stdout/stderr 不重定向");
        return;
    }
    dup2(g_pfdOut[1], 1);
    dup2(g_pfdErr[1], 2);
    pthread_t t1, t2;
    pthread_create(&t1, nullptr, redirectThread, reinterpret_cast<void*>(static_cast<intptr_t>(g_pfdOut[0])));
    pthread_create(&t2, nullptr, redirectThread, reinterpret_cast<void*>(static_cast<intptr_t>(g_pfdErr[0])));
    pthread_detach(t1);
    pthread_detach(t2);
}

void* nodeThread(void* raw) {
    StartArgs* a = static_cast<StartArgs*>(raw);
    if (a->redirect) startRedirectingStdoutStderr();
    if (!a->cwd.empty() && chdir(a->cwd.c_str()) != 0) {
        LOGE("chdir failed: %s", a->cwd.c_str());
    }
    LOGI("node::Start argc=%d argv[0]=%s argv[1]=%s cwd=%s",
         a->argc,
         a->argc > 0 ? a->argv[0] : "(null)",
         a->argc > 1 ? a->argv[1] : "(null)",
         a->cwd.c_str());
    int code = node::Start(a->argc, a->argv);
    LOGI("node exited with code %d", code);
    return nullptr;
}

}  // namespace

extern "C" JNIEXPORT jint JNICALL
Java_com_tavern_app_NodeRuntime_startNode(
        JNIEnv* env, jobject /* this */,
        jobjectArray args, jstring cwd, jboolean redirectToLogcat) {
    jsize n = env->GetArrayLength(args);
    int argc = static_cast<int>(n);
    char** argv = static_cast<char**>(calloc(argc, sizeof(char*)));
    if (argv == nullptr) return -1;
    for (int i = 0; i < argc; i++) {
        jstring s = static_cast<jstring>(env->GetObjectArrayElement(args, i));
        const char* c = env->GetStringUTFChars(s, nullptr);
        argv[i] = strdup(c);
        env->ReleaseStringUTFChars(s, c);
        env->DeleteLocalRef(s);
    }
    const char* cwdChars = env->GetStringUTFChars(cwd, nullptr);
    StartArgs* sa = new StartArgs{argc, argv, std::string(cwdChars), redirectToLogcat == JNI_TRUE};
    env->ReleaseStringUTFChars(cwd, cwdChars);

    pthread_t thread;
    int rc = pthread_create(&thread, nullptr, nodeThread, sa);
    if (rc != 0) {
        LOGE("pthread_create failed: %d", rc);
        return -1;
    }
    pthread_detach(thread);
    return 0;
}
