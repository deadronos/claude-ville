package com.claudeville

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.webkit.*
import androidx.activity.ComponentActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageButton
import android.view.Gravity

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var configManager: ConfigManager

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        configManager = ConfigManager(this)
        
        val rootLayout = FrameLayout(this)
        
        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = true
        // Enable pinch zoom
        webView.settings.setSupportZoom(true)
        webView.settings.builtInZoomControls = true
        webView.settings.displayZoomControls = false
        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = true

        // Enable mixed content to allow http API calls from https assets
        webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val url = request.url
                // Only intercept internal app assets.
                if (url.host == "appassets.androidplatform.net") {
                    return assetLoader.shouldInterceptRequest(url)
                }
                return null
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                injectConfig()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectConfig()
            }
        }

        webView.addJavascriptInterface(AndroidBridge(), "Android")
        
        // Load the bundled frontend from the www directory
        webView.loadUrl("https://appassets.androidplatform.net/www/index.html")
        
        rootLayout.addView(webView, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        
        // Add a floating settings button
        val settingsButton = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_preferences)
            setBackgroundColor(0x88000000.toInt())
            setOnClickListener {
                val intent = Intent(this@MainActivity, SettingsActivity::class.java)
                startActivity(intent)
            }
        }
        val buttonParams = FrameLayout.LayoutParams(120, 120).apply {
            gravity = Gravity.BOTTOM or Gravity.END
            setMargins(0, 0, 40, 40)
        }
        rootLayout.addView(settingsButton, buttonParams)
        
        setContentView(rootLayout)
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
