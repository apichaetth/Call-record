package com.callrecord.app.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.callrecord.app.service.CallRecordingService
import com.callrecord.app.util.PreferenceManager

class PhoneStateReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == TelephonyManager.ACTION_PHONE_STATE_CHANGED) {
            val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
            val phoneNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER) ?: ""
            val prefManager = PreferenceManager(context)

            if (!prefManager.isRecordingEnabled) return

            when (state) {
                TelephonyManager.EXTRA_STATE_RINGING -> {
                    lastState = STATE_RINGING
                    savedNumber = phoneNumber
                }
                TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                    // Call answered - start recording
                    val callType = if (lastState == STATE_RINGING) "INCOMING" else "OUTGOING"
                    val number = if (savedNumber.isNotEmpty()) savedNumber else phoneNumber

                    val serviceIntent = Intent(context, CallRecordingService::class.java).apply {
                        putExtra(CallRecordingService.EXTRA_PHONE_NUMBER, number)
                        putExtra(CallRecordingService.EXTRA_CALL_TYPE, callType)
                    }
                    ContextCompat.startForegroundService(context, serviceIntent)
                    lastState = STATE_OFFHOOK
                }
                TelephonyManager.EXTRA_STATE_IDLE -> {
                    // Call ended - stop recording
                    if (lastState == STATE_OFFHOOK) {
                        val stopIntent = Intent(context, CallRecordingService::class.java).apply {
                            action = CallRecordingService.ACTION_STOP_RECORDING
                        }
                        context.startService(stopIntent)
                    }
                    lastState = STATE_IDLE
                    savedNumber = ""
                }
            }
        }
    }

    companion object {
        private const val STATE_IDLE = 0
        private const val STATE_RINGING = 1
        private const val STATE_OFFHOOK = 2

        private var lastState = STATE_IDLE
        private var savedNumber = ""
    }
}
