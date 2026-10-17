"""A declined card is said as a declined card, with both ways out on their own lines (2026-10-17).

A CLI traveller's saved card was refused three times in one evening (insufficient funds); the terminal said
"no usable payment method" and the payment link sat at the end of a sentence about 3-D Secure. He never paid.
"""
from letsfg import cli

PAY = "https://checkout.revolut.com/payment-link/XYZ"


def test_a_declined_card_prints_why_and_both_ways_out(capsys):
    cli._print_book_result({"error": "payment_declined", "booking_ref": "ref1", "pay_url": PAY,
                            "decline_message": "There was not enough money on that payment method.",
                            "change_card_emailed_to": "p***@gmail.com"})
    out = capsys.readouterr().out
    assert "your card was declined" in out and "no usable payment method" not in out
    assert "Booking started" not in out, "a decline carries a booking_ref for its link - it is not a started booking"
    assert "Why: There was not enough money" in out
    lines = [l.strip() for l in out.splitlines()]
    assert PAY in lines, "the link on a line of its own"
    assert "we e-mailed you a link (to p***@gmail.com)." in lines


def test_no_card_at_all_keeps_its_own_words(capsys):
    cli._print_book_result({"error": "payment_method_required", "add_card_url": "https://letsfg.co/connect?card=s"})
    out = capsys.readouterr().out
    assert "no usable payment method" in out and "https://letsfg.co/connect?card=s" in out


def test_a_started_booking_still_reads_as_started(capsys):
    cli._print_book_result({"booking_ref": "ref2"})
    assert "Booking started" in capsys.readouterr().out
