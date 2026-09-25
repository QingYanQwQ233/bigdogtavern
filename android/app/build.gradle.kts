plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.tavern.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.tavern.app"
        minSdk = 24
        targetSdk = 34
        // 版本控制：versionCode 由构建时 -Pvc 传入（= git commit 数，每次构建递增，避免覆盖安装冲突）；
        // versionName 语义化迭代：alpha-0.1.<构建序号>（由 -Pvn 传入）
        versionCode = (project.findProperty("vc") as String?)?.toIntOrNull() ?: 1
        versionName = (project.findProperty("vn") as String?) ?: "alpha-0.1.0"

        // 内嵌 Node 运行时（nodejs-mobile）只随包分发 arm64-v8a。
        // 显式声明 ABI，使 32 位/模拟器设备不会被误装后运行期才失败。
        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    // 固定签名：tavern.p12 提交仓库，所有构建用同一 keystore（GitHub Actions 每次全新环境会生成不同
    // debug keystore → 签名不一致 → 覆盖安装失败；固定后签名永远一致）
    signingConfigs {
        create("tavern") {
            storeFile = file("tavern.p12")
            storePassword = "tavern123"
            keyAlias = "tavern"
            keyPassword = "tavern123"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("tavern")
        }
        release {
            signingConfig = signingConfigs.getByName("tavern")
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // 后端 + 前端资源（由 scripts/sync_android_assets.sh 生成到 src/main/assets/nodejs/）
    sourceSets {
        getByName("main") {
            assets.srcDirs("src/main/assets")
        }
    }

    // jniLibs 用 legacy 打包：压缩存放 + 安装时解压到 nativeLibraryDir。
    // 内嵌 Node 运行时（libnode.so）由动态链接器按真实文件路径加载，必须解包到磁盘。
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

dependencies {
    // 后端不再依赖 NanoHTTPD：Android 端直接运行仓库里的 server.js（内嵌 Node 运行时），
    // 后端实现因此与桌面端完全同源，不再有第二份 Kotlin 重写。
}
