package com.callrecord.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.callrecord.app.CallRecordApp
import com.callrecord.app.data.db.CallRecordEntity
import com.callrecord.app.data.repository.CallRecordRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val repository: CallRecordRepository

    val allRecords: Flow<List<CallRecordEntity>>

    init {
        val dao = (application as CallRecordApp).database.callRecordDao()
        repository = CallRecordRepository(dao)
        allRecords = repository.getAllRecords()
    }

    fun deleteRecord(id: Long) {
        viewModelScope.launch {
            repository.deleteById(id)
        }
    }
}
