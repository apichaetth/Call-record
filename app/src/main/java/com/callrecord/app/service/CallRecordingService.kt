package com.callrecord.app.service

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.MediaRecorder
import android.os.Environment
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.callrecord.app.CallRecordApp
import com.callrecord.app.R
import com.callrecord.app.data.db.CallRecordEntity
import com.callrecord.app.ui.ConfirmDialogActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

class CallRecordingService : Service() {

    private var mediaRecorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var phoneNumber: String = ""
    private var callType: String = ""
    private var startTime: Long = 0L
    private val isRecording = AtomicBoolean(false)
    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(Dispatchers.IO + serviceJob)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP_RECORDING) {
            stopRecording()
            return START_NOT_STICKY
        }

        if (isRecording.get()) {
            return START_NOT_STICKY
        }

        phoneNumber = intent?.getStringExtra(EXTRA_PHONE_NUMBER) ?: "Unknown"
        callType = intent?.getStringExtra(EXTRA_CALL_TYPE) ?: "UNKNOWN"

        startForegroundNotification()
        startRecording()

        return START_NOT_STICKY
    }

    private fun startForegroundNotification() {
        val notification = NotificationCompat.Builder(this, CallRecordApp.CHANNEL_ID)
            .setContentTitle("Recording call")
            .setContentText("Call with $phoneNumber")
            .setSmallIcon(R.drawable.ic_mic)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        startForeground(NOTIFICATION_ID, notification)
    }

    private fun startRecording() {
        try {
            val recordingsDir = File(
                getExternalFilesDir(Environment.DIRECTORY_MUSIC),
                "CallRecordings"
            )
            if (!recordingsDir.exists()) {
                recordingsDir.mkdirs()
            }

            val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
            val safeNumber = phoneNumber.replace(Regex("[^0-9+]"), "")
            val fileName = "call_${callType.lowercase()}_${safeNumber}_$timestamp.m4a"
            outputFile = File(recordingsDir, fileName)

            mediaRecorder = MediaRecorder(this).apply {
                setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(44100)
                setAudioEncodingBitRate(128000)
                setOutputFile(outputFile!!.absolutePath)
                prepare()
                start()
            }

            startTime = System.currentTimeMillis()
            isRecording.set(true)
        } catch (e: Exception) {
            e.printStackTrace()
            cleanup()
            stopSelf()
        }
    }

    private fun stopRecording() {
        if (!isRecording.compareAndSet(true, false)) {
            stopSelf()
            return
        }

        val duration = (System.currentTimeMillis() - startTime) / 1000

        try {
            mediaRecorder?.apply {
                stop()
                release()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        mediaRecorder = null

        val file = outputFile
        if (file != null && file.exists() && file.length() > 0) {
            saveRecordAndShowDialog(duration, file)
        } else {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun saveRecordAndShowDialog(duration: Long, file: File) {
        val dao = (application as CallRecordApp).database.callRecordDao()

        serviceScope.launch {
            val record = CallRecordEntity(
                phoneNumber = phoneNumber,
                callType = callType,
                timestamp = startTime,
                duration = duration,
                filePath = file.absolutePath,
                fileSize = file.length()
            )
            val recordId = dao.insert(record)

            val dialogIntent = Intent(this@CallRecordingService, ConfirmDialogActivity::class.java).apply {
                putExtra(ConfirmDialogActivity.EXTRA_RECORD_ID, recordId)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(dialogIntent)

            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun cleanup() {
        try {
            mediaRecorder?.release()
        } catch (_: Exception) {}
        mediaRecorder = null
        outputFile?.let { if (it.exists()) it.delete() }
        isRecording.set(false)
    }

    override fun onDestroy() {
        if (isRecording.get()) {
            cleanup()
        }
        serviceJob.cancel()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_PHONE_NUMBER = "extra_phone_number"
        const val EXTRA_CALL_TYPE = "extra_call_type"
        const val ACTION_STOP_RECORDING = "action_stop_recording"
        private const val NOTIFICATION_ID = 1001
    }
}
