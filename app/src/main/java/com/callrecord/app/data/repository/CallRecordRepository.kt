package com.callrecord.app.data.repository

import com.callrecord.app.data.db.CallRecordDao
import com.callrecord.app.data.db.CallRecordEntity
import kotlinx.coroutines.flow.Flow
import java.io.File

class CallRecordRepository(private val dao: CallRecordDao) {

    fun getAllRecords(): Flow<List<CallRecordEntity>> = dao.getAll()

    suspend fun insert(record: CallRecordEntity): Long = dao.insert(record)

    suspend fun getById(id: Long): CallRecordEntity? = dao.getById(id)

    suspend fun deleteById(id: Long) {
        val record = dao.getById(id)
        if (record != null) {
            val file = File(record.filePath)
            if (file.exists()) {
                file.delete()
            }
            dao.deleteById(id)
        }
    }
}
