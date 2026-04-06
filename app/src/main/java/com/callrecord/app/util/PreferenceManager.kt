package com.callrecord.app.util

import android.content.Context
import android.content.SharedPreferences

class PreferenceManager(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("call_record_prefs", Context.MODE_PRIVATE)

    var isRecordingEnabled: Boolean
        get() = prefs.getBoolean(KEY_RECORDING_ENABLED, false)
        set(value) = prefs.edit().putBoolean(KEY_RECORDING_ENABLED, value).apply()

    companion object {
        private const val KEY_RECORDING_ENABLED = "recording_enabled"
    }
}
