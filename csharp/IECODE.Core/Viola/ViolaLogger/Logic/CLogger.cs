using System.Runtime.InteropServices;

namespace Viola.Core.ViolaLogger.Logic
{

    public enum ImportantInfoType
    {
        Normal,
        Fatal
    }
    public struct ImportantInfo
    {
        public bool IsFatal;
        public string Message;

        public ImportantInfo(string message, bool isFatal)
        {
            this.Message = message;
            this.IsFatal = isFatal;
        }
    }
    public static class CLogger
    {
        //Using the Windows API directly to avoid complications with creating multiple WinForms helper projects
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);
        public static void ShowMessage(string message)
        {
            if (OperatingSystem.IsWindows())
            {
                _ = MessageBox(IntPtr.Zero, message, "Viola", 0);
            }
            else
            {
                Console.WriteLine($"[Viola Message] {message}");
            }
        }
        //Viola console rich text box buffer. Null in CLI mode
        public static event Action<string>? GuiLogInfoEvent;
        private static List<string>? _importantInfos;

        public static void AddImportantInfo(string info)
        {
            if (_importantInfos == null)
            {
                _importantInfos = new();
            }
            _importantInfos.Add(info);
        }
        public static void LogInfo(string msg)
        {
            //Meaning CLI mode is enabled
            if (GuiLogInfoEvent == null)
            {
                Console.WriteLine(msg);
            }
            else
            {
                GuiLogInfoEvent(msg + "\n");
            }
        }
        public static void InvokeImportantInfos()
        {
            if (_importantInfos == null) return;
            foreach (var info in _importantInfos)
            {
                //Meaning CLI mode is enabled
                if (GuiLogInfoEvent == null)
                {
                    Console.Write(info);
                }
                else
                {
                    ShowMessage(info);
                }
            }

            _importantInfos = null;
        }

    }
}
