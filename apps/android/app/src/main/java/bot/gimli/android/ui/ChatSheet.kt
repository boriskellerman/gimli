package bot.gimli.android.ui

import androidx.compose.runtime.Composable
import bot.gimli.android.MainViewModel
import bot.gimli.android.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
