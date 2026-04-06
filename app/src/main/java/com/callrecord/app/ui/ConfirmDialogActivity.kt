package com.callrecord.app.ui

import android.os.Bundle
import android.os.CountDownTimer
import androidx.appcompat.app.AppCompatActivity
import com.callrecord.app.CallRecordApp
import com.callrecord.app.data.repository.CallRecordRepository
import com.callrecord.app.databinding.ActivityConfirmDialogBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ConfirmDialogActivity : AppCompatActivity() {

    private lateinit var binding: ActivityConfirmDialogBinding
    private lateinit var repository: CallRecordRepository
    private var recordId: Long = -1
    private var countDownTimer: CountDownTimer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityConfirmDialogBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val dao = (application as CallRecordApp).database.callRecordDao()
        repository = CallRecordRepository(dao)
        recordId = intent.getLongExtra(EXTRA_RECORD_ID, -1)

        if (recordId == -1L) {
            finish()
            return
        }

        loadRecordDetails()
        setupButtons()
        startAutoDismissTimer()
    }

    private fun loadRecordDetails() {
        CoroutineScope(Dispatchers.IO).launch {
            val record = repository.getById(recordId)
            withContext(Dispatchers.Main) {
                if (record != null) {
                    val dateFormat = SimpleDateFormat("MMM dd, yyyy HH:mm", Locale.getDefault())
                    val date = dateFormat.format(Date(record.timestamp))
                    val type = if (record.callType == "INCOMING") "Incoming" else "Outgoing"
                    val duration = formatDuration(record.duration)
                    val size = formatFileSize(record.fileSize)

                    binding.tvCallInfo.text = "$type call"
                    binding.tvPhoneNumber.text = record.phoneNumber.ifEmpty { "Unknown number" }
                    binding.tvDateTime.text = date
                    binding.tvDuration.text = "Duration: $duration"
                    binding.tvFileSize.text = "Size: $size"
                } else {
                    finish()
                }
            }
        }
    }

    private fun setupButtons() {
        binding.btnKeep.setOnClickListener {
            countDownTimer?.cancel()
            finish()
        }

        binding.btnDelete.setOnClickListener {
            countDownTimer?.cancel()
            deleteAndFinish()
        }
    }

    private fun startAutoDismissTimer() {
        countDownTimer = object : CountDownTimer(AUTO_DISMISS_MS, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val seconds = millisUntilFinished / 1000
                binding.tvAutoSave.text = "Auto-keeping in ${seconds}s"
            }

            override fun onFinish() {
                finish()
            }
        }.start()
    }

    private fun deleteAndFinish() {
        CoroutineScope(Dispatchers.IO).launch {
            repository.deleteById(recordId)
            withContext(Dispatchers.Main) {
                finish()
            }
        }
    }

    private fun formatDuration(seconds: Long): String {
        val mins = seconds / 60
        val secs = seconds % 60
        return String.format(Locale.getDefault(), "%d:%02d", mins, secs)
    }

    private fun formatFileSize(bytes: Long): String {
        return when {
            bytes < 1024 -> "$bytes B"
            bytes < 1024 * 1024 -> "${bytes / 1024} KB"
            else -> String.format(Locale.getDefault(), "%.1f MB", bytes / (1024.0 * 1024.0))
        }
    }

    override fun onDestroy() {
        countDownTimer?.cancel()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_RECORD_ID = "extra_record_id"
        private const val AUTO_DISMISS_MS = 60_000L
    }
}
