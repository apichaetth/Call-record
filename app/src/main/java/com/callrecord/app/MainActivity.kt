package com.callrecord.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.callrecord.app.data.db.CallRecordEntity
import com.callrecord.app.databinding.ActivityMainBinding
import com.callrecord.app.ui.MainViewModel
import com.callrecord.app.ui.adapter.CallRecordAdapter
import com.callrecord.app.util.PreferenceManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.io.File

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefManager: PreferenceManager
    private lateinit var adapter: CallRecordAdapter
    private val viewModel: MainViewModel by viewModels()

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.values.all { it }
        if (!allGranted) {
            prefManager.isRecordingEnabled = false
            binding.switchActivate.isChecked = false
            Toast.makeText(this, "Permissions required for call recording", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefManager = PreferenceManager(this)
        setupToolbar()
        setupToggle()
        setupRecyclerView()
        observeRecords()
    }

    private fun setupToolbar() {
        setSupportActionBar(binding.toolbar)
        supportActionBar?.title = "Call Recorder"
    }

    private fun setupToggle() {
        binding.switchActivate.isChecked = prefManager.isRecordingEnabled

        binding.switchActivate.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                if (hasRequiredPermissions()) {
                    prefManager.isRecordingEnabled = true
                    updateStatusText(true)
                } else {
                    requestPermissions()
                    prefManager.isRecordingEnabled = true
                    updateStatusText(true)
                }
            } else {
                prefManager.isRecordingEnabled = false
                updateStatusText(false)
            }
        }

        updateStatusText(prefManager.isRecordingEnabled)
    }

    private fun updateStatusText(enabled: Boolean) {
        binding.tvStatus.text = if (enabled) "Recording is active" else "Recording is disabled"
    }

    private fun setupRecyclerView() {
        adapter = CallRecordAdapter(
            onItemClick = { record -> playRecording(record) },
            onDeleteClick = { record -> confirmDelete(record) }
        )
        binding.recyclerView.layoutManager = LinearLayoutManager(this)
        binding.recyclerView.adapter = adapter
    }

    private fun observeRecords() {
        lifecycleScope.launch {
            viewModel.allRecords.collectLatest { records ->
                adapter.submitList(records)
                binding.tvEmpty.visibility = if (records.isEmpty()) {
                    android.view.View.VISIBLE
                } else {
                    android.view.View.GONE
                }
            }
        }
    }

    private fun playRecording(record: CallRecordEntity) {
        val file = File(record.filePath)
        if (!file.exists()) {
            Toast.makeText(this, "Recording file not found", Toast.LENGTH_SHORT).show()
            return
        }
        val uri: Uri = FileProvider.getUriForFile(this, "${packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "audio/mp4")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "No app found to play audio", Toast.LENGTH_SHORT).show()
        }
    }

    private fun confirmDelete(record: CallRecordEntity) {
        MaterialAlertDialogBuilder(this)
            .setTitle("Delete Recording")
            .setMessage("Are you sure you want to delete this recording?")
            .setPositiveButton("Delete") { _, _ ->
                viewModel.deleteRecord(record.id)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun hasRequiredPermissions(): Boolean {
        val permissions = getRequiredPermissions()
        return permissions.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun requestPermissions() {
        permissionLauncher.launch(getRequiredPermissions())
    }

    private fun getRequiredPermissions(): Array<String> {
        val permissions = mutableListOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_CALL_LOG
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        return permissions.toTypedArray()
    }
}
