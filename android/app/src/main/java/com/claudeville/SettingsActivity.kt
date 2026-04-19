package com.claudeville

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class SettingsActivity : ComponentActivity() {
    private lateinit var configManager: ConfigManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configManager = ConfigManager(this)

        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    SettingsScreen(
                        configManager = configManager,
                        onBack = { finish() }
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(configManager: ConfigManager, onBack: () -> Unit) {
    var hubHost by remember { mutableStateOf(configManager.hubHost) }
    var hubPort by remember { mutableStateOf(configManager.hubPort) }
    var useSsl by remember { mutableStateOf(configManager.useSsl) }
    var authToken by remember { mutableStateOf(configManager.authToken) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("App Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Text("<") // Simple back button for now
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .padding(16.dp)
                .fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            OutlinedTextField(
                value = hubHost,
                onValueChange = { hubHost = it },
                label = { Text("Hub Host") },
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = hubPort,
                onValueChange = { hubPort = it },
                label = { Text("Hub Port") },
                modifier = Modifier.fillMaxWidth()
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Use SSL (HTTPS/WSS)")
                Switch(checked = useSsl, onCheckedChange = { useSsl = it })
            }

            OutlinedTextField(
                value = authToken,
                onValueChange = { authToken = it },
                label = { Text("Auth Token") },
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.weight(1f))

            Button(
                onClick = {
                    configManager.hubHost = hubHost
                    configManager.hubPort = hubPort
                    configManager.useSsl = useSsl
                    configManager.authToken = authToken
                    onBack()
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Save & Apply")
            }
        }
    }
}
