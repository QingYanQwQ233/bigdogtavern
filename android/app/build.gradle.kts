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

    // 前端资源（public/ 由 GitHub Actions 在构建前复制到 src/main/assets/）
    sourceSets {
        getByName("main") {
            assets.srcDirs("src/main/assets")
        }
    }
}

dependencies {
    implementation("org.nanohttpd:nanohttpd:2.3.1")
}
