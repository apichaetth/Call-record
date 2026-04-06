package com.callrecord.app.ui.adapter

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.callrecord.app.data.db.CallRecordEntity
import com.callrecord.app.databinding.ItemCallRecordBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class CallRecordAdapter(
    private val onItemClick: (CallRecordEntity) -> Unit,
    private val onDeleteClick: (CallRecordEntity) -> Unit
) : ListAdapter<CallRecordEntity, CallRecordAdapter.ViewHolder>(DiffCallback()) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemCallRecordBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class ViewHolder(
        private val binding: ItemCallRecordBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(record: CallRecordEntity) {
            val dateFormat = SimpleDateFormat("MMM dd, yyyy HH:mm", Locale.getDefault())
            val duration = formatDuration(record.duration)
            val typeLabel = if (record.callType == "INCOMING") "Incoming" else "Outgoing"

            binding.tvPhoneNumber.text = record.phoneNumber.ifEmpty { "Unknown" }
            binding.tvCallType.text = typeLabel
            binding.tvDateTime.text = dateFormat.format(Date(record.timestamp))
            binding.tvDuration.text = duration

            binding.root.setOnClickListener { onItemClick(record) }
            binding.btnDelete.setOnClickListener { onDeleteClick(record) }
        }

        private fun formatDuration(seconds: Long): String {
            val mins = seconds / 60
            val secs = seconds % 60
            return String.format(Locale.getDefault(), "%d:%02d", mins, secs)
        }
    }

    private class DiffCallback : DiffUtil.ItemCallback<CallRecordEntity>() {
        override fun areItemsTheSame(oldItem: CallRecordEntity, newItem: CallRecordEntity) =
            oldItem.id == newItem.id

        override fun areContentsTheSame(oldItem: CallRecordEntity, newItem: CallRecordEntity) =
            oldItem == newItem
    }
}
