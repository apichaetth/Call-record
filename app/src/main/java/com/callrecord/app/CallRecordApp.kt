package com.callrecord.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.callrecord.app.data.db.AppDatabase

class CallRecordApp : Application() {

    val database: AppDatabase by lazy { AppDatabase.getInstance(this) }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Call Recording",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows when a call is being recorded"
            setSound(null, null)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "call_recording_channel"
    }
}
