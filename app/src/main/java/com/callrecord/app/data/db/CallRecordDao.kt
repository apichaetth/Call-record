package com.callrecord.app.data.db

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface CallRecordDao {

    @Insert
    suspend fun insert(record: CallRecordEntity): Long

    @Delete
    suspend fun delete(record: CallRecordEntity)

    @Query("DELETE FROM call_records WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("SELECT * FROM call_records ORDER BY timestamp DESC")
    fun getAll(): Flow<List<CallRecordEntity>>

    @Query("SELECT * FROM call_records WHERE id = :id")
    suspend fun getById(id: Long): CallRecordEntity?
}
