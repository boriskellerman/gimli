package bot.gimli.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class GimliProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", GimliCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", GimliCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", GimliCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", GimliCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", GimliCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", GimliCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", GimliCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", GimliCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", GimliCapability.Canvas.rawValue)
    assertEquals("camera", GimliCapability.Camera.rawValue)
    assertEquals("screen", GimliCapability.Screen.rawValue)
    assertEquals("voiceWake", GimliCapability.VoiceWake.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", GimliScreenCommand.Record.rawValue)
  }
}
