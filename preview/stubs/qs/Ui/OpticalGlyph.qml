import QtQuick
import qs.Commons

Text {
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.icon
  horizontalAlignment: Text.AlignHCenter
  verticalAlignment: Text.AlignVCenter
  font.family: fontFamily
  font.pixelSize: fontSize
  textFormat: Text.PlainText
}
