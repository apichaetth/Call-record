package com.callrecord.app.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "call_records")
data class CallRecordEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val phoneNumber: String,
    val callType: String,
    val timestamp: Long,
    val duration: Long,
    val filePath: String,
    val fileSize: Long
)
