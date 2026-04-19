package com.claudeville

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.webkit.*
import androidx.activity.ComponentActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var configManager: ConfigManager

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        configManager = ConfigManager(this)
        
        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = true
        
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectConfig()
            }
        }

        webView.addJavascriptInterface(AndroidBridge(), "Android")
        
        // Load the bundled frontend
        // Using a custom domain for asset loader to work correctly
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
        
        setContentView(webView)
    }

    private fun injectConfig() {
        val configJson = configManager.getRuntimeConfigJson()
        val script = "window.__CLAUDEVILLE_CONFIG__ = $configJson; console.log('Android: Config injected');"
        webView.evaluateJavascript(script, null)
    }

    @Suppress("unused")
    inner class AndroidBridge {
        @JavascriptInterface
        fun openSettings() {
            val intent = Intent(this@MainActivity, SettingsActivity::class.java)
            startActivity(intent)
        }
    }

    override fun onResume() {
        super.onResume()
        // Re-inject config in case it changed in SettingsActivity
        injectConfig()
        // Also reload if necessary or just let the frontend react to config changes
    }
}
