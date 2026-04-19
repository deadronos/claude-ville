package com.claudeville

import android.content.Context
import android.content.SharedPreferences

class ConfigManager(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("claudeville_prefs", Context.MODE_PRIVATE)

    companion object {
        const val KEY_HUB_HOST = "hub_host"
        const val KEY_HUB_PORT = "hub_port"
        const val KEY_USE_SSL = "use_ssl"
        const val KEY_AUTH_TOKEN = "auth_token"
        
        const val DEFAULT_HUB_HOST = "10.0.2.2"
        const val DEFAULT_HUB_PORT = "3030"
    }

    var hubHost: String
        get() = prefs.getString(KEY_HUB_HOST, DEFAULT_HUB_HOST) ?: DEFAULT_HUB_HOST
        set(value) = prefs.edit().putString(KEY_HUB_HOST, value).apply()

    var hubPort: String
        get() = prefs.getString(KEY_HUB_PORT, DEFAULT_HUB_PORT) ?: DEFAULT_HUB_PORT
        set(value) = prefs.edit().putString(KEY_HUB_PORT, value).apply()

    var useSsl: Boolean
        get() = prefs.getBoolean(KEY_USE_SSL, false)
        set(value) = prefs.edit().putBoolean(KEY_USE_SSL, value).apply()

    var authToken: String
        get() = prefs.getString(KEY_AUTH_TOKEN, "") ?: ""
        set(value) = prefs.edit().putString(KEY_AUTH_TOKEN, value).apply()

    fun getHubHttpUrl(): String {
        val protocol = if (useSsl) "https" else "http"
        return "$protocol://$hubHost:$hubPort"
    }

    fun getHubWsUrl(): String {
        val protocol = if (useSsl) "wss" else "ws"
        return "$protocol://$hubHost:$hubPort"
    }
    
    fun getRuntimeConfigJson(): String {
        return """
            {
                "hubHttpUrl": "${getHubHttpUrl()}",
                "hubWsUrl": "${getHubWsUrl()}",
                "authToken": "$authToken"
            }
        """.trimIndent()
    }
}
